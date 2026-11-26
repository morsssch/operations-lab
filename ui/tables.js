globalThis.labTables = (() => {
  const { element } = labForms;
  const label = value => {
    const node = element('span');
    const variable = /^([xyWAB])(\d+)(′?)$/.exec(value);
    if (variable) node.append(variable[1], element('sub', variable[2]), variable[3]);
    else node.textContent = value;
    return node;
  };

  function render(model) {
    const wrap = element('div', undefined, { class: 'result-table-scroll', tabindex: '0',
      role: 'region', 'aria-label': model.caption });
    const table = element('table', undefined, { class: 'result-table' });
    table.append(element('caption', model.caption, { class: 'sr-only' }));
    const headers = table.createTHead().insertRow();
    for (const value of model.headers) {
      const cell = element('th', undefined, { scope: 'col' });
      cell.append(label(value));
      if (!value) cell.setAttribute('aria-label', 'Базис');
      headers.append(cell);
    }
    const body = table.createTBody();
    const foot = model.footer ? table.createTFoot() : null;
    const basis = new Set(model.basis.map(cell => cell.join(':')));
    const pivot = model.pivot?.join(':');
    for (const [i, values] of model.rows.entries()) {
      const row = (i >= model.rows.length - model.footer ? foot : body).insertRow();
      for (const [j, value] of values.entries()) {
        const cell = j === 0 ? element('th', undefined, { scope: 'row' }) : element('td');
        cell.append(label(value));
        const key = i + ':' + j;
        if (key === pivot) {
          cell.className = 'pivot';
          cell.setAttribute('aria-label', value + ', разрешающий элемент');
          cell.title = 'Разрешающий элемент';
        } else if (basis.has(key)) {
          cell.className = 'basic';
          cell.setAttribute('aria-label', value + ', базисная клетка');
          cell.title = 'Базисная клетка';
          cell.append(element('sup', '*', { 'aria-hidden': 'true' }));
        }
        row.append(cell);
      }
    }
    wrap.append(table);
    return wrap;
  }

  return { render };
})();
