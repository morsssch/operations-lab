globalThis.labTransport = (() => {
  const { zero, number } = labMath;
  const { dimensions } = labProblem;
  const { transportReport, response } = labReports;

  function run(data) {
    dimensions(data.costs, data.supply, data.demand, 30);
    const costs = data.costs.map((row, supplier) =>
      row.map((value, consumer) => number(value, `Тариф A${supplier + 1}, B${consumer + 1}`)),
    );
    const supply = data.supply.map((value, index) => number(value, `Запас A${index + 1}`));
    const demand = data.demand.map((value, index) => number(value, `Потребность B${index + 1}`));

    const result = solve(costs, supply, demand, data.initial ?? 'northwest');
    return response(result.status, result.message, transportReport(result), {
      value: String(result.cost),
    });
  }

  function solve(costs, supply, demand, method) {
    if ([...supply, ...demand].some(value => value.sign < 0)) {
      throw new Error('Запасы и потребности не могут быть отрицательными.');
    }
    if (method !== 'northwest' && method !== 'least_cost') {
      throw new Error('Выберите способ построения начального плана.');
    }

    const dummy = balance(costs, supply, demand);
    const cells = supply.flatMap((_, row) => demand.map((_, column) => [row, column]));
    const order = ([row, column]) => row * demand.length + column;
    const { plan, basis } = initialPlan(costs, supply, demand, method, cells);

    const steps = [];
    const visited = new Set();
    let useBland = false;
    const limit = 400;

    function record(title, comment, potentialData = {}, cycle = []) {
      steps.push({
        title,
        comment,
        ...potentialData,
        cycle,
        plan: plan.map(row => row.slice()),
        basis: [...basis],
        cost: total(plan, costs),
      });
    }

    const methodLabel = method === 'northwest'
      ? 'Метод северо-западного угла.'
      : 'Метод минимальной стоимости.';
    record(
      'Начальный план',
      methodLabel + ' При необходимости базис дополнен нулевыми клетками до дерева.',
    );

    let status = 'limit';
    for (let iteration = 0; iteration <= limit; iteration += 1) {
      const potentialData = potentials(costs, basis);
      const { estimates } = potentialData;
      const improving = cells.filter(cell => {
        const [row, column] = cell;
        return !basis.has(cell) && estimates[row][column].sign < 0;
      });

      if (!improving.length) {
        record('Оптимальный план', 'Все оценки свободных клеток Δij = cij − ui − vj ≥ 0.', potentialData);
        status = 'optimal';
        break;
      }
      if (iteration === limit) {
        record('Последний план', 'Достигнут предел пересчётов.', potentialData);
        break;
      }

      const key = [...basis].map(order).sort((first, second) => first - second).join(',');
      const switched = !useBland && visited.has(key);
      if (switched) useBland = true;
      visited.add(key);
      improving.sort((first, second) => {
        const [row, column] = first;
        const [otherRow, otherColumn] = second;
        const byEstimate = useBland ? 0 : estimates[row][column].compare(estimates[otherRow][otherColumn]);
        return byEstimate || order(first) - order(second);
      });
      const entering = improving[0];
      const [row, column] = entering;

      const cycle = cyclePath(basis, entering, supply.length, demand.length);
      const minusCells = cycle.filter((_, index) => index % 2 === 1);
      minusCells.sort((first, second) => {
        const [row, column] = first;
        const [otherRow, otherColumn] = second;
        const byShipment = plan[row][column].compare(plan[otherRow][otherColumn]);
        return byShipment || order(first) - order(second);
      });
      const leaving = minusCells[0];
      const [leavingRow, leavingColumn] = leaving;
      const amount = plan[leavingRow][leavingColumn];

      const before = total(plan, costs);
      const after = before.plus(amount.times(estimates[row][column]));
      const rule = switched ? 'Базис повторился. Применяем правило Бланда. ' : '';
      const explanation = rule + `Δ(${row + 1},${column + 1}) < 0; цикл +/−, θ = ${amount}. ` +
        `Из базиса вышла A${leavingRow + 1}–B${leavingColumn + 1}. Стоимость: ${before} → ${after}.`;
      record(`Итерация ${iteration + 1}: ввод A${row + 1}–B${column + 1}`, explanation, potentialData, cycle);

      for (const [index, [cycleRow, cycleColumn]] of cycle.entries()) {
        const shipment = plan[cycleRow][cycleColumn];
        plan[cycleRow][cycleColumn] = index % 2 === 0 ? shipment.plus(amount) : shipment.minus(amount);
      }
      basis.delete(leaving);
      basis.add(entering);
    }

    const message = status === 'optimal' ? 'Найден оптимальный план перевозок.'
      : 'Достигнут предел итераций; оптимальность не установлена.';
    return { status, message, plan, cost: total(plan, costs), costs, supply, demand, steps, dummy };
  }

  const total = (plan, costs) => sum(plan.map((row, index) => dot(row, costs[index])));

  function balance(costs, supply, demand) {
    const difference = sum(supply).minus(sum(demand));
    if (difference.sign < 0) {
      supply.push(difference.negate());
      costs.push(demand.map(() => zero));
      return `Добавлен фиктивный поставщик A${supply.length} с запасом ${difference.negate()} и тарифами 0.`;
    }
    if (difference.sign > 0) {
      demand.push(difference);
      costs.forEach(row => row.push(zero));
      return `Добавлен фиктивный потребитель B${demand.length} с потребностью ${difference} и тарифами 0.`;
    }
    return '';
  }

  function completeTree(basis, cells, supplierCount, consumerCount) {
    const parent = indices(supplierCount + consumerCount);

    function root(node) {
      while (node !== parent[node]) node = parent[node];
      return node;
    }

    const count = parent.length - 1;
    for (const cell of [...basis, ...cells]) {
      const [row, column] = cell;
      const supplier = root(row);
      const consumer = root(supplierCount + column);
      if (supplier === consumer) continue;
      parent[consumer] = supplier;
      basis.add(cell);
    }
    if (basis.size !== count) {
      throw new Error('Начальный транспортный базис не является деревом.');
    }
  }

  function initialPlan(costs, supply, demand, method, cells) {
    const stock = supply.slice();
    const needs = demand.slice();
    const plan = costs.map(row => row.map(() => zero));
    const basis = new Set();
    const width = demand.length;

    function allocate(cell) {
      const [row, column] = cell;
      const amount = stock[row].compare(needs[column]) <= 0 ? stock[row] : needs[column];
      plan[row][column] = amount;
      basis.add(cell);
      stock[row] = stock[row].minus(amount);
      needs[column] = needs[column].minus(amount);
    }

    if (method === 'northwest') {
      let row = 0;
      let column = 0;
      while (row < supply.length && column < width) {
        allocate(cells[row * width + column]);
        if (!stock[row].sign) row += 1;
        if (!needs[column].sign) column += 1;
      }
    } else {
      const sorted = cells.slice().sort(([row, column], [otherRow, otherColumn]) => {
        const byCost = costs[row][column].compare(costs[otherRow][otherColumn]);
        return byCost || row - otherRow || column - otherColumn;
      });

      for (const cell of sorted) {
        const [row, column] = cell;
        if (stock[row].sign && needs[column].sign) allocate(cell);
      }
    }

    if ([...stock, ...needs].some(value => value.sign)) {
      throw new Error('Не удалось распределить весь груз.');
    }

    completeTree(basis, cells, supply.length, width);
    return { plan, basis };
  }

  function potentials(costs, basis) {
    const suppliers = costs.map(() => null);
    const consumers = costs[0].map(() => null);
    suppliers[0] = zero;

    for (let pass = 0; pass < suppliers.length + consumers.length; pass += 1) {
      let changed = false;
      for (const [row, column] of basis) {
        if (suppliers[row] !== null && consumers[column] === null) {
          consumers[column] = costs[row][column].minus(suppliers[row]);
          changed = true;
        }
        if (consumers[column] !== null && suppliers[row] === null) {
          suppliers[row] = costs[row][column].minus(consumers[column]);
          changed = true;
        }
      }
      if (!changed) break;
    }
    if ([...suppliers, ...consumers].includes(null)) {
      throw new Error('Транспортный базис не связан.');
    }

    const estimates = costs.map((row, supplier) =>
      row.map((cost, consumer) => cost.minus(suppliers[supplier]).minus(consumers[consumer])),
    );
    return { suppliers, consumers, estimates };
  }

  function cyclePath(basis, entering, supplierCount, consumerCount) {
    const graph = indices(supplierCount + consumerCount).map(() => []);

    for (const cell of basis) {
      const [supplier, consumer] = cell;
      const consumerNode = supplierCount + consumer;
      graph[supplier].push({ node: consumerNode, cell });
      graph[consumerNode].push({ node: supplier, cell });
    }

    const start = supplierCount + entering[1];
    const finish = entering[0];
    const nextNodes = [start];
    const previous = new Map([[start, null]]);

    for (const current of nextNodes) {
      if (current === finish) break;
      for (const { node, cell } of graph[current]) {
        if (previous.has(node)) continue;
        previous.set(node, { from: current, cell });
        nextNodes.push(node);
      }
    }
    if (!previous.has(finish)) throw new Error('Нет пути для цикла перевозок.');

    const path = [];
    for (let node = finish; node !== start;) {
      const { from, cell } = previous.get(node);
      path.push(cell);
      node = from;
    }
    return [entering, ...path.reverse()];
  }

  function sum(values) {
    let total = zero;
    for (const value of values) {
      total = total.plus(value);
    }
    return total;
  }

  function dot(left, right) {
    let total = zero;
    for (const [index, value] of left.entries()) {
      total = total.plus(value.times(right[index]));
    }
    return total;
  }

  const indices = length => Array.from({ length }, (_, index) => index);

  return { run };
})();
