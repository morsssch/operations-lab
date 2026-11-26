globalThis.labForms = (() => {
  const fill = (length, value) => Array.from({ length }, (_, i) => value(i));
  function shape(data) {
    if ('costs' in data) return [data.supply.length, data.demand.length];
    return [data.b.length, data.c.length];
  }

  function resize(data, rows, cols, reset = false) {
    const matrix = key => fill(rows, i => fill(cols, j => reset ? '0' : data[key][i]?.[j] ?? '0'));
    const vector = (key, size, fallback = '0') => fill(size, i => reset ? fallback : data[key][i] ?? fallback);
    if ('costs' in data) {
      return { ...data, costs: matrix('costs'), supply: vector('supply', rows), demand: vector('demand', cols) };
    }
    const resized = { ...data, A: matrix('A'), b: vector('b', rows), c: vector('c', cols), signs: vector('signs', rows, '<=') };
    if ('plan' in data) resized.plan = vector('plan', cols);
    return resized;
  }

  function element(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function field(data, key, i, j, name, choices = null) {
    const field = choices ? element('select') : element('input', undefined, {
      type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 80,
    });
    field.setAttribute('aria-label', name);
    if (choices) {
      choices.forEach(([value, label]) => field.append(element('option', label, { value })));
    }
    const [owner, property] = j !== null ? [data[key][i], j] : i !== null ? [data[key], i] : [data, key];
    field.value = owner[property];
    field.addEventListener('input', () => { owner[property] = field.value; });
    return field;
  }

  function table(caption, columns, rows) {
    const box = element('div', undefined, { class: 'scroll-table', role: 'region', 'aria-label': caption, tabindex: '0' });
    const grid = element('table', undefined, { 'aria-label': caption });
    const headings = grid.createTHead().insertRow();
    for (const title of columns) headings.append(element('th', title, { scope: 'col' }));
    const body = grid.createTBody();
    for (const [title, ...fields] of rows) {
      const row = body.insertRow();
      if (title !== null) row.append(element('th', title, { scope: 'row' }));
      for (const field of fields) {
        const cell = row.insertCell();
        if (field) cell.append(field);
      }
    }
    box.append(grid);
    return box;
  }

  const signs = [['<=', '≤'], ['>=', '≥'], ['=', '=']];

  function fields(data) {
    const [rows, cols] = shape(data);
    if ('costs' in data) {
      const columns = fill(cols, j => 'B' + (j + 1));
      const values = fill(rows, i => {
        const label = 'A' + (i + 1);
        return [label, ...columns.map((b, j) => field(data, 'costs', i, j, 'Тариф ' + label + ', ' + b)),
          field(data, 'supply', i, null, 'Запас ' + label)];
      });
      values.push(['Спрос', ...columns.map((b, j) => field(data, 'demand', j, null, 'Потребность ' + b)), null]);
      const option = field(data, 'initial', null, null, 'Начальный план',
        [['northwest', 'Северо-западный угол'], ['least_cost', 'Минимальная стоимость']]);
      return {
        option, optionLabel: 'Начальный план',
        tables: [element('h3', 'Тарифы, запасы и потребности'), table('Тарифы и объёмы', ['', ...columns, 'Запас'], values)],
        hint: 'Если запасы и спрос различаются, добавится фиктивный поставщик или потребитель с нулевыми тарифами.',
      };
    }
    const columns = fill(cols, j => 'x' + (j + 1));
    const objective = columns.map((x, j) => field(data, 'c', j, null, 'Цель, ' + x));
    const values = fill(rows, i => [String(i + 1),
      ...columns.map((x, j) => field(data, 'A', i, j, 'Строка ' + (i + 1) + ', ' + x)),
      field(data, 'signs', i, null, 'Знак строки ' + (i + 1), signs),
      field(data, 'b', i, null, 'Правая часть строки ' + (i + 1))]);
    const tables = [
      element('h3', 'Целевая функция'), table('Целевая функция', columns, [[null, ...objective]]),
      element('h3', 'Ограничения'), table('Ограничения', ['№', ...columns, 'Знак', 'b'], values),
    ];
    if ('plan' in data) {
      const point = columns.map((name, index) => field(data, 'plan', index, null, 'Заданный план, ' + name));
      tables.push(element('h3', 'Заданный план'), table('Заданный план', columns, [[null, ...point]]));
    }
    return {
      option: field(data, 'sense', null, null, 'Направление', [['max', 'Максимум'], ['min', 'Минимум']]),
      optionLabel: 'Направление',
      tables,
    };
  }
  return { element, fields, resize, shape };
})();
