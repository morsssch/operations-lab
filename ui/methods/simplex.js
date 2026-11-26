globalThis.labSimplex = (() => {
  const { zero, one } = labMath;
  const { parseProblem } = labProblem;
  const { tableauProof, linearResponse, canonicalForm, tableauSnapshot } = labReports;
  const limit = 300;

  function run(data) {
    const problem = parseProblem(data);
    const result = solveFromInitialTableau(problem);
    const afterTables = [];
    if (result.status === 'optimal') {
      const { table } = result;
      const estimates = table.estimates();
      const freeEstimates = table.nonbasic.map(column => estimates[column]);
      afterTables.push(...tableauProof(table.right, freeEstimates));
    }
    return linearResponse(problem, result, { afterTables });
  }

  function solveFromInitialTableau(problem) {
    const table = createTableau(problem);
    if (!table) {
      throw new Error('Не удалось построить начальный базис из имеющихся столбцов.');
    }

    const status = primalSimplex(table);
    return linearResult(problem, table, status, ['Прямой симплекс']);
  }

  function primalSimplex(table) {
    let title = 'Начальная таблица';
    if (table.right.some(value => value.sign < 0)) {
      throw new Error('Для прямого симплекса нужен допустимый начальный план.');
    }

    const visited = new Set();
    let useBland = false;

    for (let iteration = 0; iteration <= limit; iteration += 1) {
      const estimates = table.estimates();
      const enteringOptions = table.nonbasic.filter(column =>
        estimates[column].sign < 0,
      );

      if (!enteringOptions.length) {
        table.record(title, 'Все Δ ≥ 0 и δ ≥ 0: решение найдено.');
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

  const flipped = { '<=': '>=', '>=': '<=', '=': '=' };

  class Tableau {
    constructor({
      matrix, right, prices, variableNames, basic,
    }) {
      this.matrix = matrix;
      this.right = right;
      this.prices = prices;
      this.variableNames = variableNames;
      this.basic = basic;
      this.nonbasic = indices(prices.length).filter(column => !basic.includes(column));

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
      return dot(this.basicPrices(), this.right);
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
  }

  function createTableau(problem) {
    const { objective, constraints, bounds, relations, sense } = problem;
    const rowCount = bounds.length;
    const originalWidth = objective.length;
    const variableNames = objective.map((_, column) => `x${column + 1}`);
    const prices = objective.map(value => sense === 'max' ? value : value.negate());
    const basic = bounds.map(() => -1);

    const rowSigns = relations.map((relation, rowIndex) => {
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

      if (basic[row] === -1) return null;
    }

    return new Tableau({ matrix, right, prices, variableNames, basic });
  }

  function linearResult(problem, table, status, route) {
    if (status !== 'optimal') {
      return { table, status, route, point: [], value: null };
    }

    const point = table.point().slice(0, problem.objective.length);
    const value = dot(problem.objective, point);
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
