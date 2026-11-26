globalThis.labDualSimplex = (() => {
  const { zero, one } = labMath;
  const { parseProblem } = labProblem;
  const { heading, prose, formula, linearResponse, canonicalForm, tableauSnapshot } = labReports;
  const limit = 300;

  function run(data) {
    const problem = parseProblem(data);
    const result = solve(problem);
    const opening = [];
    const beforePlan = [];

    if (result.substitutions) {
      opening.push(
        heading('Замена ограниченных переменных'),
        prose('Верхние границы следуют из исходных ограничений и неотрицательности переменных.'),
        ...result.substitutions.map(line => formula(line)),
      );
      beforePlan.push(prose('Возвращаемся к исходным переменным по формулам замены.'));
    }

    return linearResponse(problem, result, { opening, beforePlan });
  }

  function solve(problem) {
    const initial = createTableau(problem);
    if (!initial) {
      const { table, status } = artificialBasis(problem);
      return linearResult(problem, table, status, [
        'Двойственный симплекс неприменим: нет начального базиса',
        'МИБ (фаза I → фаза II)',
      ]);
    }

    const feasible = initial.right.every(value => value.sign >= 0);
    const estimatesNonnegative = initial.estimates().every(value => value.sign >= 0);
    if (estimatesNonnegative) {
      const label = feasible ? 'Двойственный симплекс (уже оптимально)' : 'Двойственный симплекс';
      const status = dualSimplex(initial);
      return linearResult(problem, initial, status, [label]);
    }

    const transformed = boundedDualStart(problem, initial);
    if (transformed) {
      const { table, substitutions, restore } = transformed;
      const status = dualSimplex(table, 'Начальная таблица после замены');
      initial.record('Начальная таблица до замены', 'Есть отрицательные оценки Δ.');
      table.steps.unshift(...initial.steps);

      const result = linearResult(
        problem, table, status, ['Замена ограниченных переменных → двойственный симплекс'], restore,
      );
      return { ...result, substitutions };
    }

    if (feasible) {
      const status = optimizeFeasibleBasis(initial);
      return linearResult(problem, initial, status, [
        'Двойственный симплекс неприменим: Δj < 0 → прямой симплекс',
      ]);
    }

    const { table, status } = artificialBasis(problem);
    return linearResult(problem, table, status, [
      'Двойственный симплекс неприменим: есть Δj < 0',
      'МИБ (фаза I → фаза II)',
    ]);
  }

  function dualSimplex(table, title = 'Начальная таблица') {
    if (table.estimates().some(value => value.sign < 0)) {
      throw new Error('Для двойственного симплекса необходимы Δj ≥ 0.');
    }

    const visited = new Set();
    let useBland = false;

    for (let iteration = 0; iteration <= limit; iteration += 1) {
      const leavingOptions = [];
      for (const [row, rightPart] of table.right.entries()) {
        if (rightPart.sign < 0) {
          leavingOptions.push(row);
        }
      }

      if (!leavingOptions.length) {
        table.record(title, 'Все δ ≥ 0 и Δ ≥ 0: решение найдено.');
        return 'optimal';
      }
      if (iteration === limit) break;

      const key = table.basic.slice().sort((first, second) => first - second).join(',');
      if (!useBland && visited.has(key)) {
        useBland = true;
        table.note('Переход к правилу Бланда', 'Базис повторился. Дальше выбираем по индексам.');
      }
      visited.add(key);

      leavingOptions.sort((first, second) => {
        const byRightPart = useBland ? 0 : table.right[first].compare(table.right[second]);
        return byRightPart || table.basic[first] - table.basic[second];
      });

      const leaving = leavingOptions[0];
      const leavingName = table.variableNames[table.basic[leaving]];
      const estimates = table.estimates();
      const ratios = new Map();

      for (const column of table.nonbasic) {
        const entry = table.matrix[leaving][column];
        if (entry.sign < 0) {
          ratios.set(column, estimates[column].over(entry));
        }
      }

      if (!ratios.size) {
        const explanation =
          `В строке ${leavingName} (δ < 0) нет отрицательных элементов: ограничения несовместны.`;
        table.record(title, explanation, { rowRatios: ratios });
        return 'infeasible';
      }

      const enteringOptions = [...ratios.keys()];
      enteringOptions.sort((first, second) => {
        const byRatioDescending = ratios.get(second).compare(ratios.get(first));
        return byRatioDescending || first - second;
      });

      const entering = enteringOptions[0];
      const enteringName = table.variableNames[entering];
      const pivot = table.matrix[leaving][entering];
      const reason = useBland ? 'правило Бланда' : `наименьшая δ = ${table.right[leaving]}`;
      const explanation =
        `Ведущая строка ${leavingName} (${reason}). ` +
        `Ведущий столбец ${enteringName} (max Δ/a = ${ratios.get(entering)}). ` +
        `Ведущий элемент ${pivot}.`;

      table.record(title, explanation, {
        rowRatios: ratios,
        pivot: [leaving, entering],
      });
      table.exchange(leaving, entering);
      title = `Пересчёт: ${enteringName} ↔ ${leavingName}`;
    }

    table.record(title, 'Достигнут предел пересчётов.');
    return 'limit';
  }

  function upperBound(problem, column) {
    let bound = null;

    for (const [index, row] of problem.constraints.entries()) {
      const coefficient = row[column];
      const rightPart = problem.bounds[index];
      if (problem.relations[index] === '>=' || rightPart.sign < 0 || coefficient.sign <= 0) {
        continue;
      }
      if (row.some(value => value.sign < 0)) {
        continue;
      }

      const candidate = rightPart.over(coefficient);
      if (bound === null || candidate.compare(bound) < 0) {
        bound = candidate;
      }
    }

    return bound;
  }

  function boundedDualStart(problem, initial) {
    const estimates = initial.estimates();
    const replaced = initial.nonbasic.filter(column => estimates[column].sign < 0);
    if (replaced.some(column => column >= problem.objective.length)) {
      return null;
    }

    const upperBounds = new Map();
    for (const column of replaced) {
      const bound = upperBound(problem, column);
      if (bound === null) {
        return null;
      }
      upperBounds.set(column, bound);
    }

    const variableNames = problem.objective.map((_, column) => {
      const suffix = upperBounds.has(column) ? '′' : '';
      return `x${column + 1}${suffix}`;
    });

    const offsets = problem.objective.map((_, column) => upperBounds.get(column) ?? zero);
    const constraints = problem.constraints.map(row =>
      row.map((value, column) => upperBounds.has(column) ? value.negate() : value),
    );
    const right = problem.bounds.map((value, row) => {
      const shift = dot(problem.constraints[row], offsets);
      return value.minus(shift);
    });
    const relations = problem.relations.slice();

    for (const [column, bound] of upperBounds) {
      const upperBoundRow = problem.objective.map((_, index) => index === column ? one : zero);
      constraints.push(upperBoundRow);
      right.push(bound);
      relations.push('<=');
    }

    const objective = problem.objective.map((value, column) =>
      upperBounds.has(column) ? value.negate() : value,
    );
    const objectiveShift = dot(problem.objective, offsets);
    const table = createTableau({
      objective,
      constraints,
      bounds: right,
      relations,
      sense: problem.sense,
      variableNames,
      constant: problem.sense === 'max' ? objectiveShift : objectiveShift.negate(),
    });
    if (!table || table.estimates().some(value => value.sign < 0)) {
      return null;
    }

    const substitutions = [...upperBounds].map(([column, bound]) => {
      const name = variableNames[column];
      return `x${column + 1} = ${bound} − ${name}, 0 ≤ ${name} ≤ ${bound}`;
    });

    function restore(point) {
      return point.map((value, column) => {
        const bound = upperBounds.get(column);
        return bound === undefined ? value : bound.minus(value);
      });
    }


    return { table, substitutions, restore };
  }

  function optimizeFeasibleBasis(
    table,
    title = 'Начальная таблица',
    finalNote = 'Все Δ ≥ 0 и δ ≥ 0: решение найдено.',
  ) {
    if (table.right.some(value => value.sign < 0)) {
      throw new Error('Для прямого симплекса нужен допустимый начальный план.');
    }

    const visited = new Set();
    let useBland = false;

    for (let iteration = 0; iteration <= limit; iteration += 1) {
      const estimates = table.estimates();
      const enteringOptions = table.nonbasic.filter(column =>
        !table.artificial.has(column) && estimates[column].sign < 0,
      );

      if (!enteringOptions.length) {
        table.record(title, finalNote);
        return 'optimal';
      }
      if (iteration === limit) break;

      const key = table.basic.slice().sort((first, second) => first - second).join(',');
      if (!useBland && visited.has(key)) {
        useBland = true;
        table.note('Переход к правилу Бланда', 'Базис повторился. Дальше выбираем по индексам.');
      }
      visited.add(key);

      enteringOptions.sort((first, second) => {
        const byEstimate = useBland ? 0 : estimates[first].compare(estimates[second]);
        return byEstimate || first - second;
      });

      const entering = enteringOptions[0];
      const enteringName = table.variableNames[entering];
      const ratios = table.matrix.map((row, index) => {
        const coefficient = row[entering];
        return coefficient.sign > 0 ? table.right[index].over(coefficient) : null;
      });
      const leavingOptions = [];

      for (const [row, ratio] of ratios.entries()) {
        if (ratio !== null) {
          leavingOptions.push(row);
        }
      }

      if (!leavingOptions.length) {
        const explanation =
          `В столбце ${enteringName} нет положительных элементов: целевая функция не ограничена.`;
        table.record(title, explanation, { columnRatios: ratios });
        return 'unbounded';
      }

      leavingOptions.sort((first, second) => {
        const byRatio = ratios[first].compare(ratios[second]);
        return byRatio || table.basic[first] - table.basic[second];
      });

      const leaving = leavingOptions[0];
      const leavingName = table.variableNames[table.basic[leaving]];
      const pivot = table.matrix[leaving][entering];
      const reason = useBland ? 'правило Бланда' : `наименьшая Δ = ${estimates[entering]}`;
      const explanation =
        `Ведущий столбец ${enteringName} (${reason}). ` +
        `Ведущая строка ${leavingName} (min δ/a = ${ratios[leaving]}). ` +
        `Ведущий элемент ${pivot}.`;

      table.record(title, explanation, {
        columnRatios: ratios,
        pivot: [leaving, entering],
      });
      table.exchange(leaving, entering);
      title = `Пересчёт: ${enteringName} ↔ ${leavingName}`;
    }

    table.record(title, 'Достигнут предел пересчётов.');
    return 'limit';
  }

  function artificialBasis(problem) {
    const table = createTableau(problem, { feasibleStart: true });
    const originalPrices = table.prices.slice();

    if (!table.artificial.size) {
      const status = optimizeFeasibleBasis(table, 'Искусственные переменные не нужны. Начальная таблица');
      return { table, status };
    }

    table.prices = table.prices.map((_, column) =>
      table.artificial.has(column) ? one.negate() : zero,
    );
    const phaseOneStatus = optimizeFeasibleBasis(
      table,
      'Фаза I: f(x, w) → max',
      'Все Δ ≥ 0 и δ ≥ 0: фаза I завершена.',
    );
    if (phaseOneStatus !== 'optimal') {
      return { table, status: 'limit' };
    }

    const auxiliaryValue = table.objective();
    if (auxiliaryValue.sign) {
      table.note('Фаза I завершена', `f(x, w) = ${auxiliaryValue} < 0: допустимого плана нет.`);
      return { table, status: 'infeasible' };
    }

    let row = 0;
    while (row < table.basic.length) {
      const current = table.basic[row];
      if (table.artificial.has(current)) {
        const candidates = table.nonbasic.filter(column =>
          !table.artificial.has(column) && table.matrix[row][column].sign !== 0,
        );
        const entering = candidates.sort((first, second) => first - second)[0];

        if (entering === undefined) {
          const originalRowNumber = table.originalRows[row] + 1;
          table.note(
            `Удаляем зависимое ограничение №${originalRowNumber}`,
            'Строка нулевая по настоящим переменным.',
          );
          table.dropRow(row);
          continue;
        }
        const leavingName = table.variableNames[current];
        const enteringName = table.variableNames[entering];

        table.exchange(row, entering);
        table.record(
          `Убираем ${leavingName} из базиса`,
          `${leavingName} заменяется на ${enteringName}.`,
        );
      }
      row += 1;
    }

    table.finishPhaseOne(originalPrices);
    const status = optimizeFeasibleBasis(table, 'Фаза II: таблица без W, Δ по исходной целевой функции');
    return { table, status };
  }

  const flipped = { '<=': '>=', '>=': '<=', '=': '=' };

  class Tableau {
    constructor({
      matrix, right, prices, variableNames, basic, artificial, constant,
    }) {
      this.matrix = matrix;
      this.right = right;
      this.prices = prices;
      this.variableNames = variableNames;
      this.basic = basic;
      this.nonbasic = indices(prices.length).filter(column => !basic.includes(column));
      this.artificial = artificial;
      this.constant = constant;

      this.originalRows = indices(right.length);
      this.steps = [];
      this.canonical = canonicalForm(this);
    }

    basicPrices() {
      return this.basic.map(column => this.prices[column]);
    }

    estimates() {
      const basicPrices = this.basicPrices();
      return this.prices.map((price, column) => {
        const coefficients = this.matrix.map(row => row[column]);
        const impliedPrice = dot(basicPrices, coefficients);
        return impliedPrice.minus(price);
      });
    }

    objective() {
      return dot(this.basicPrices(), this.right).plus(this.constant);
    }

    note(title, explanation) {
      this.steps.push({ title, explanation });
    }

    record(title, explanation, options = {}) {
      const estimates = this.estimates();
      const value = this.objective();
      this.steps.push(tableauSnapshot(this, title, explanation, estimates, value, options));
    }

    exchange(leavingRow, enteringColumn) {
      const pivot = this.matrix[leavingRow][enteringColumn];
      if (!pivot.sign) {
        throw new Error('Нулевой разрешающий элемент.');
      }

      const pivotRow = this.matrix[leavingRow].map(value => value.over(pivot));
      const pivotRight = this.right[leavingRow].over(pivot);

      for (const [rowIndex, row] of this.matrix.entries()) {
        const scale = row[enteringColumn];
        if (rowIndex === leavingRow || !scale.sign) {
          continue;
        }

        this.matrix[rowIndex] = row.map((value, column) =>
          value.minus(scale.times(pivotRow[column])),
        );
        this.right[rowIndex] = this.right[rowIndex].minus(scale.times(pivotRight));
      }

      this.matrix[leavingRow] = pivotRow;
      this.right[leavingRow] = pivotRight;

      const freePosition = this.nonbasic.indexOf(enteringColumn);
      this.nonbasic[freePosition] = this.basic[leavingRow];
      this.basic[leavingRow] = enteringColumn;
    }

    point() {
      const point = this.prices.map(() => zero);
      for (const [row, column] of this.basic.entries()) {
        point[column] = this.right[row];
      }
      return point;
    }

    dropRow(index) {
      this.matrix.splice(index, 1);
      this.right.splice(index, 1);
      this.basic.splice(index, 1);
      this.originalRows.splice(index, 1);
    }

    finishPhaseOne(originalPrices) {
      const kept = indices(this.prices.length).filter(column => !this.artificial.has(column));
      const positions = new Map(kept.map((column, index) => [column, index]));

      this.matrix = this.matrix.map(row => kept.map(column => row[column]));
      this.prices = kept.map(column => originalPrices[column]);
      this.variableNames = kept.map(column => this.variableNames[column]);

      this.basic = this.basic.map(column => positions.get(column));
      this.nonbasic = this.nonbasic
        .filter(column => positions.has(column))
        .map(column => positions.get(column));
      this.artificial.clear();
    }
  }

  function createTableau(problem, { feasibleStart = false } = {}) {
    const { objective, constraints, bounds, relations, sense } = problem;
    const rowCount = bounds.length;
    const originalWidth = objective.length;
    const variableNames = problem.variableNames?.slice()
      ?? objective.map((_, column) => `x${column + 1}`);
    const prices = objective.map(value => sense === 'max' ? value : value.negate());
    const basic = bounds.map(() => -1);

    const rowSigns = relations.map((relation, rowIndex) => {
      if (feasibleStart) return bounds[rowIndex].sign < 0 ? one.negate() : one;
      if (relation === '>=') return one.negate();
      if (relation !== '=') return one;

      for (let column = 0; column < originalWidth; column += 1) {
        const entry = constraints[rowIndex][column];
        const isBasicColumn = entry.sign && constraints.every((row, index) =>
          index === rowIndex || !row[column].sign,
        );
        if (isBasicColumn) {
          return entry.sign > 0 ? one : one.negate();
        }
      }
      return one;
    });
    const matrix = constraints.map((row, index) => row.map(value => value.times(rowSigns[index])));
    const right = bounds.map((value, index) => value.times(rowSigns[index]));

    const artificial = new Set();

    function appendColumn(name, rowIndex, entry) {
      const column = variableNames.length;
      variableNames.push(name);
      prices.push(zero);
      matrix.forEach((row, index) => row.push(index === rowIndex ? entry : zero));
      return column;
    }

    for (const [rowIndex, relation] of relations.entries()) {
      const sign = rowSigns[rowIndex].sign < 0 ? flipped[relation] : relation;
      if (sign === '=') continue;

      const name = `x${variableNames.length + 1}`;
      const coefficient = sign === '<=' ? one : one.negate();
      const column = appendColumn(name, rowIndex, coefficient);
      if (sign === '<=') basic[rowIndex] = column;
    }

    for (let row = 0; row < rowCount; row += 1) {
      if (basic[row] !== -1) continue;

      for (let column = 0; column < originalWidth; column += 1) {
        const pivot = matrix[row][column];
        const isBasicColumn = pivot.sign > 0 && matrix.every((line, index) =>
          index === row || !line[column].sign,
        );
        if (!isBasicColumn) continue;

        matrix[row] = matrix[row].map(value => value.over(pivot));
        right[row] = right[row].over(pivot);
        basic[row] = column;
        break;
      }

      if (basic[row] !== -1) continue;
      if (!feasibleStart) return null;

      const column = appendColumn(`W${artificial.size + 1}`, row, one);
      basic[row] = column;
      artificial.add(column);
    }

    return new Tableau({
      matrix, right, prices, variableNames, basic, artificial,
      constant: problem.constant ?? zero,
    });
  }

  function linearResult(problem, table, status, route, restore) {
    let point = [];
    let value = null;

    if (status === 'optimal') {
      point = table.point().slice(0, problem.objective.length);
      if (restore) {
        point = restore(point);
      }
      value = dot(problem.objective, point);
    }

    return { table, status, route, point, value };
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
