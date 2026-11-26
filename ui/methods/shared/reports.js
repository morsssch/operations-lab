globalThis.labReports = (() => {
  const { format, one } = labMath;
  const heading = text => ({ kind: 'heading', text });
  const step = text => ({ kind: 'step', text });
  const prose = text => ({ kind: 'text', text });
  const vector = values => '(' + values.map(format).join('; ') + ')';
  const relationLabel = { '<=': '≤', '>=': '≥', '=': '=' };

  function latex(text) {
    return text.replace(/(\d+)\/(\d+)/g, '\\frac{$1}{$2}')
      .replace(/([xyWABbc])(\d+)/g, '$1_{$2}')
      .replace(/_(min|max)\b/g, (_, direction) => '_{\\' + direction + '}')
      .replace(/(^|[^A-Za-z\\])(min|max)\b/g, '$1\\$2')
      .replaceAll('любого знака', '\\in\\mathbb{R}')
      .replaceAll('<=', '\\le ').replaceAll('>=', '\\ge ')
      .replaceAll('≤', '\\le ').replaceAll('≥', '\\ge ')
      .replaceAll('∈', '\\in ').replaceAll('→', '\\to ').replaceAll('−', '-')
      .replaceAll('∞', '\\infty ').replaceAll('…', '\\dots ')
      .replaceAll('Δ', '\\Delta ').replaceAll('δ', '\\delta ').replaceAll('θ', '\\theta ')
      .replaceAll('∅', '\\varnothing').replaceAll('′', "'")
      .replaceAll('*', '^{*}').replaceAll(';', ';\\,').replaceAll(', ', ',\\;');
  }

  function formula(expression, prefix = '', suffix = '', notation = latex(expression)) {
    return { kind: 'formula', text: prefix + expression + suffix, prefix, suffix, latex: notation };
  }

  function table(caption, headers, rows, { pivot = null, basis = [], footer = 0 } = {}) {
    return { kind: 'table', caption, headers, rows: rows.map(row => row.map(format)), pivot, basis, footer };
  }

  function plainTable(item) {
    const raw = [item.headers.slice(), ...item.rows.map(row => row.slice())];
    for (const [row, column] of item.basis) raw[row + 1][column] += '*';
    if (item.pivot) {
      const [row, column] = item.pivot;
      raw[row + 1][column] = '[' + raw[row + 1][column] + ']';
    }
    const widths = item.headers.map((_, index) => Math.max(...raw.map(row => row[index].length)));
    const lines = raw.map(row => row.map((value, index) => value.padStart(widths[index])).join('  '));
    lines.splice(1, 0, widths.map(width => '─'.repeat(width)).join('  '));
    return lines.join('\n');
  }

  function plainReport(items) {
    const lines = [];
    for (const item of items) {
      if (lines.length && (item.kind === 'heading' || item.kind === 'step')) lines.push('');
      lines.push(item.kind === 'table' ? plainTable(item) : item.text);
    }
    return lines.join('\n') + '\n';
  }

  const statuses = {
    optimal: 'Оптимальный план найден.',
    unbounded: 'Целевая функция не ограничена в направлении оптимизации.',
    infeasible: 'Допустимого плана не существует.',
    limit: 'Достигнут предел итераций: автоматический вывод об оптимальности невозможен.',
  };

  function linear(coefficients, names = coefficients.map((_, index) => `x${index + 1}`)) {
    let expression = '';
    for (const [index, coefficient] of coefficients.entries()) {
      if (!coefficient.sign) continue;

      const negative = coefficient.sign < 0;
      const magnitude = negative ? coefficient.negate() : coefficient;
      const coefficientText = magnitude.compare(one) === 0 ? '' : String(magnitude);

      if (expression) {
        expression += negative ? ' − ' : ' + ';
      } else if (negative) {
        expression = '−';
      }
      expression += coefficientText + names[index];
    }
    return expression || '0';
  }

  function canonicalForm(table) {
    let objective = linear(table.prices, table.variableNames);
    if (table.constant?.sign > 0) {
      objective += ` + ${table.constant}`;
    } else if (table.constant?.sign < 0) {
      objective += ` − ${table.constant.negate()}`;
    }

    const constraints = table.matrix.map((row, index) => {
      const left = linear(row, table.variableNames);
      return `${left} = ${table.right[index]}`;
    });
    const basicNames = table.basic.map(column => table.variableNames[column]);
    const lines = [
      `f(x) = ${objective} → max`,
      ...constraints,
      table.variableNames.join(', ') + ' ≥ 0',
      'Базисные переменные: ' + basicNames.join(', '),
    ];
    if (table.artificial?.size) {
      const names = [...table.artificial].map(column => table.variableNames[column]);
      const auxiliaryObjective = linear(names.map(() => one.negate()), names);
      lines.push(`Вспомогательная цель: f(x, w) = ${auxiliaryObjective} → max`);
    }
    return lines;
  }

  function tableauSnapshot(table, title, explanation, estimates, value, options) {
    const { columnRatios, rowRatios, pivot } = options;
    return {
      title,
      explanation,
      headers: table.nonbasic.map(column => table.variableNames[column]),
      rows: table.matrix.map(row => table.nonbasic.map(column => row[column])),
      basis: table.basic.map(column => table.variableNames[column]),
      right: table.right.slice(),
      estimates: table.nonbasic.map(column => estimates[column]),
      value,
      columnRatios,
      rowRatios: rowRatios && table.nonbasic.map(column => rowRatios.get(column) ?? null),
      pivot: pivot && [pivot[0], table.nonbasic.indexOf(pivot[1])],
    };
  }

  function statement(problem) {
    return [
      formula(`f(x) = ${linear(problem.objective)} → ${problem.sense}`),
      prose('Ограничения:'),
      ...problem.constraints.map((row, index) => formula(
        `${linear(row)} ${problem.relations[index]} ${problem.bounds[index]}`)),
      formula('x1, x2, … ≥ 0'),
    ];
  }

  function simplexTable(item) {
    const headers = ['', ...item.headers, 'δ'];
    const rows = item.basis.map((name, index) => [name, ...item.rows[index], item.right[index]]);
    const last = ['Δ', ...item.estimates, item.value];
    if (item.columnRatios) {
      headers.push('min');
      rows.forEach((row, index) => row.push(item.columnRatios[index] ?? '—'));
      last.push('');
    }
    rows.push(last);
    if (item.rowRatios) rows.push(['Δ/a', ...item.rowRatios.map(value => value ?? '—'), '']);
    const pivot = item.pivot ? [item.pivot[0], item.pivot[1] + 1] : null;
    return table('Симплекс-таблица', headers, rows, { pivot, footer: item.rowRatios ? 2 : 1 });
  }

  function response(status, message, { blocks, summary }, details = {}) {
    return { status, message, summary, report: blocks, export: plainReport(blocks), ...details };
  }

  function linearResponse(problem, result, { opening = [], afterTables = [], beforePlan = [], closing = [] } = {}) {
    const blocks = [heading('Решение задачи линейного программирования'), ...statement(problem)];
    blocks.push(...opening);
    blocks.push(heading('Каноническая форма'));
    if (problem.sense === 'min') blocks.push(prose('f(x) → min заменяется на −f(x) → max (умножаем на −1).'));
    for (const line of result.table.canonical) {
      const separator = line.indexOf(': ');
      blocks.push(separator < 0 ? formula(line) : formula(line.slice(separator + 2), line.slice(0, separator + 2)));
    }
    blocks.push(heading('Последовательность методов'), prose(result.route.join(' → ')), heading('Симплекс-таблицы'));

    let count = 0;
    for (const item of result.table.steps) {
      if (item.value !== undefined) {
        count += 1;
        blocks.push(step(`Таблица ${count}. ${item.title}`), prose(item.explanation), simplexTable(item));
      } else blocks.push(step(item.title), prose(item.explanation));
    }

    blocks.push(...afterTables);
    const message = statuses[result.status];
    blocks.push(heading('Итог'), prose(message));
    const summary = [];
    if (result.status === 'optimal') {
      if (problem.sense === 'min') blocks.push(formula(`f_max = ${result.value.negate()}`, '', ' (для −f)'));
      blocks.push(...beforePlan);
      summary.push(formula(`f_${problem.sense} = ${result.value}`), formula('x* = ' + vector(result.point)));
      blocks.push(...summary);
    }
    blocks.push(...closing);

    return response(result.status, message, { blocks, summary }, {
      value: result.value === null ? null : String(result.value),
      x: result.point.map(String),
      sense: problem.sense,
    });
  }

  function tableauProof(right, estimates) {
    const blocks = [heading('Проверка на оптимальность'), step('Допустимость плана')];
    if (right.length) {
      blocks.push(formula('δ = ' + vector(right)),
        prose('Свободные переменные равны нулю. Правые части задают значения базисных переменных. ' +
          'Все эти значения неотрицательны, поэтому план допустим.'));
    } else blocks.push(prose('Базисных строк нет. Условие по правым частям выполнено.'));
    blocks.push(step('Оценки свободных переменных'));
    if (estimates.length) {
      blocks.push(formula('Δ = ' + vector(estimates)),
        prose('В таблице на максимум из текущего значения цели вычитаются произведения оценок ' +
          'на свободные переменные. Все оценки и переменные неотрицательны, поэтому значение цели увеличить нельзя.'));
    } else blocks.push(prose('Свободных переменных в таблице нет. Условие по оценкам выполнено.'));
    return blocks;
  }

  function evaluatedRows(items) {
    return items.map(({ left, relation, right, valid }, index) =>
      [index + 1, left, relationLabel[relation], right, valid ? 'Да' : 'Нет']);
  }

  function optimalityReport(problem, result) {
    const blocks = [heading('Проверка на оптимальность'), ...statement(problem),
      formula('x = ' + vector(result.plan)), step('Допустимость заданного плана'),
      prose(result.negative.length
        ? 'Отрицательные компоненты: ' + result.negative.map(index => `x${index + 1}`).join(', ') + '.'
        : 'Все компоненты заданного плана неотрицательны.'),
      table('Подстановка в ограничения прямой задачи', ['№', 'Левая часть', 'Знак', 'Правая часть', 'Выполнено'],
        evaluatedRows(result.primal))];

    if (result.system) {
      const { model, positive, strict, equations, system } = result;
      const set = values => values.length ? '\\{' + values.map(index => index + 1).join(', ') + '\\}' : '∅';
      const setFormula = (name, values) => formula(`${name} = ${set(values).replaceAll('\\', '')}`,
        '', '', latex(`${name} = ${set(values)}`));
      blocks.push(step('Двойственная задача'), ...model.statement.map(line => formula(line)),
        step('Условия дополняющей нежёсткости'),
        prose('J содержит номера положительных компонент x. I содержит номера строгих неравенств прямой задачи.'),
        setFormula('J', positive), setFormula('I', strict),
        prose('Для j из J двойственное ограничение обращается в равенство. Для i из I двойственная переменная равна нулю.'));
      if (equations.length) {
        blocks.push(...equations.map(row => formula(`${linear(row.slice(0, -1), model.names)} = ${row[row.length - 1]}`)),
          table('Расширенная матрица после исключения Гаусса', [...model.names, 'Правая часть'], system.matrix));
      } else blocks.push(prose('Дополняющая нежёсткость не добавляет равенств.'));
      if (system.consistent && system.pivots.length < model.names.length) {
        blocks.push(prose(result.familySearch
          ? 'У системы есть свободные переменные. Проверяем, можно ли подобрать их с учётом всех двойственных условий.'
          : 'У системы есть свободные переменные. Проверяем решение, полученное при их нулевых значениях.'));
      }
      if (result.point) {
        blocks.push(step('Проверка двойственных условий'),
          formula('y = ' + vector(result.point)),
          table('Подстановка в ограничения двойственной задачи',
            ['№', 'Левая часть', 'Знак', 'Правая часть', 'Выполнено'], evaluatedRows(result.verification.constraints)),
          table('Знаки двойственных переменных', ['Переменная', 'Значение', 'Требование', 'Выполнено'],
            result.verification.signs.map(({ value, relation, valid }, index) =>
              [model.names[index], value, relation ? relationLabel[relation] + ' 0' : 'Любой знак', valid ? 'Да' : 'Нет'])));
      }
      if (result.dualValue !== undefined) {
        blocks.push(formula(`f(x) = ${result.primalValue}; g(y) = ${result.dualValue}`));
      }
    }

    blocks.push(heading('Итог'), prose(result.reason));
    return { blocks, summary: result.status === 'optimal'
      ? [formula('y* = ' + vector(result.point)), formula(`f(x) = g(y) = ${result.dualValue}`)] : [] };
  }

  function pairReport(pair) {
    const blocks = [];
    if (!pair.viaMatrix) return blocks;
    const { model } = pair;
    blocks.push(step('Способ 1. По оценкам итоговой таблицы'),
      formula('Δj = (y, Aj) − cj', '', '', '\\Delta_j = y^T A^j - c_j'));
    blocks.push(table('Уравнения из итоговых оценок', ['Переменная', 'Δ', 'Уравнение'],
      pair.order.map((column, index) => {
        const equation = pair.equations[index];
        return [pair.names[column], pair.estimates[column],
          `${linear(equation.slice(0, -1), model.names)} = ${equation[equation.length - 1]}`];
      })));
    if (!pair.basis) {
      blocks.push(prose('Часть ограничений зависима. Свободные компоненты y берём из пересчётов базиса.'));
    }
    blocks.push(formula('y* = ' + vector(pair.viaEstimates)),
      step('Способ 2. По базисной матрице'),
      formula('y* = cB · B⁻¹', '', '', 'y^{*T} = c_B^T B^{-1}'));
    if (pair.basis) {
      blocks.push(formula('B ='), table('Базисная матрица B', ['Строка', ...pair.basisNames],
        pair.basis.map((row, index) => [index + 1, ...row])));
      blocks.push(formula('B⁻¹ =', '', '', 'B^{-1} ='), table('Обратная матрица B⁻¹', ['Базис', ...model.names],
        pair.inverted.map((row, index) => [pair.basisNames[index], ...row])));
    } else {
      blocks.push(prose('После удаления зависимых строк используем матрицу пересчёта исходных правых частей.'));
    }
    blocks.push(formula('cB = ' + vector(pair.basicPrices), '', '', 'c_B = ' + latex(vector(pair.basicPrices))),
      formula('y* = ' + vector(pair.viaMatrix)),
      formula(`f = ${pair.primalValue}; g = ${pair.dualValue}`),
      prose(pair.valid ? 'Оба способа дали один вектор. Значения целей равны, двойственные условия выполнены.'
        : 'Не удалось подтвердить совпадение решений и выполнение двойственных условий.'));
    return blocks;
  }

  function stabilityReport(problem, stability) {
    const interval = ([lower, upper]) => `[${lower ?? '−∞'}; ${upper ?? '+∞'}]`;
    return [
      heading('Анализ устойчивости базиса'),
      prose('Интервалы коэффициентов целевой функции (меняем по одному):'),
      ...stability.prices.map((values, index) => formula(`c${index + 1} = ${problem.objective[index]}: ${interval(values)}`)),
      prose('Интервалы правых частей ограничений (меняем по одному):'),
      ...stability.bounds.map((values, index) => formula(`b${index + 1} = ${problem.bounds[index]}: ${interval(values)}`)),
      prose('В каждом интервале меняется ровно один коэффициент; остальные фиксированы. ' +
        'Границы описывают сохранение текущего оптимального базиса.'),
      prose('На границе интервала возможно несколько оптимальных базисов.'),
    ];
  }

  function transportReport(result) {
    const columns = result.demand.map((_, index) => `B${index + 1}`);
    const suppliers = result.supply.map((_, index) => `A${index + 1}`);
    const rows = result.costs.map((row, index) => [suppliers[index], ...row, result.supply[index]]);
    const demand = result.demand.map((value, index) => `${columns[index]}=${value}`).join(', ');
    const label = result.status === 'optimal' ? 'Минимальная стоимость ' : 'Стоимость последнего плана ';
    const value = `${result.status === 'optimal' ? 'Z*' : 'Z'} = ${result.cost}`;

    const blocks = [heading('Транспортная задача (минимизация затрат)')];
    if (result.dummy) blocks.push(prose(result.dummy));
    blocks.push(prose('Тарифы перевозок:'),
      table('Тарифы перевозок', ['Поставщик', ...columns, 'Запас'], rows),
      formula(demand, 'Потребности: '), heading('Итог'), prose(result.message), formula(value, label),
      heading('Пошаговые таблицы'));
    const headers = ['A / B', ...columns];
    const namedRows = matrix => matrix.map((row, index) => [suppliers[index], ...row]);
    for (const [index, item] of result.steps.entries()) {
      const basis = item.basis.map(([row, column]) => [row, column + 1])
        .sort(([row, column], [nextRow, nextColumn]) => row - nextRow || column - nextColumn);
      blocks.push(step(`Шаг ${index + 1}. ${item.title}`), prose(item.comment),
        table('План перевозок', headers, namedRows(item.plan), { basis }),
        prose('Звёздочка (*) обозначает базисную клетку, включая нулевую.'),
        formula(String(item.cost), 'Суммарные затраты: '));
      if (item.suppliers) {
        blocks.push(formula(item.suppliers.join(', '), 'Потенциалы u:  '),
          formula(item.consumers.join(', '), 'Потенциалы v:  '),
          formula('Δij = cij − ui − vj', 'Оценки ', ':', '\\Delta_{ij} = c_{ij} - u_i - v_j'),
          table('Оценки свободных клеток', headers, namedRows(item.estimates)));
      }
      if (item.cycle.length) {
        const cycle = item.cycle.map(([row, column], position) =>
          `${position % 2 === 0 ? '+' : '−'}A${row + 1}B${column + 1}`).join(' → ');
        blocks.push(formula(cycle, 'Цикл: '));
      }
    }
    return { blocks, summary: [formula(value)] };
  }

  return {
    heading, step, prose, formula, table, vector, latex, statement, relationLabel,
    response, linearResponse, linear, canonicalForm, tableauSnapshot,
    tableauProof, optimalityReport, pairReport, stabilityReport, transportReport,
  };
})();
