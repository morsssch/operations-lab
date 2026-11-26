globalThis.labProblem = (() => {
  const { number } = labMath;

  function dimensions(matrix, rows, columns, rowLimit) {
    if (!Array.isArray(rows) || !Array.isArray(columns)) throw new Error('Нужны строки и столбцы таблицы.');
    if (!rows.length || rows.length > rowLimit || !columns.length || columns.length > 30) {
      throw new Error('Размер таблицы вне допустимых пределов.');
    }
    if (!Array.isArray(matrix) || matrix.length !== rows.length) {
      throw new Error('Число строк матрицы не совпадает с размером задачи.');
    }
    if (matrix.some(row => !Array.isArray(row) || row.length !== columns.length)) {
      throw new Error('Число столбцов матрицы не совпадает с размером задачи.');
    }
  }

  function parseProblem(data) {
    dimensions(data.A, data.b, data.c, 40);
    const signs = { '<=': '<=', '>=': '>=', '=': '=', '≤': '<=', '≥': '>=' };
    if (!Array.isArray(data.signs) || data.signs.length !== data.b.length ||
        data.signs.some(sign => typeof sign !== 'string' || !Object.prototype.hasOwnProperty.call(signs, sign))) {
      throw new Error('Выберите допустимый знак для каждого ограничения.');
    }
    const sense = data.sense ?? 'max';
    if (sense !== 'min' && sense !== 'max') throw new Error('Цель должна быть max или min.');

    return {
      objective: data.c.map((value, column) => number(value, `Коэффициент при x${column + 1} в цели`)),
      constraints: data.A.map((row, index) =>
        row.map((value, column) => number(value, `Строка ${index + 1}, x${column + 1}`))),
      bounds: data.b.map((value, index) => number(value, `Правая часть строки ${index + 1}`)),
      relations: data.signs.map(sign => signs[sign]),
      sense,
    };
  }

  return { dimensions, parseProblem };
})();
