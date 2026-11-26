(() => {
  const { element, fields, resize, shape } = labForms;
  const { example, label: exampleLabel } = labExamples;
  const bridge = window.labBridge ?? window.webkit.messageHandlers;

  const methods = [
    ['simplex', 'Симплекс-метод', 'sigma', labSimplex.run],
    ['optimality', 'Проверка на оптимальность', 'list-checks', labOptimality.run],
    ['artificial', 'Искусственный базис', 'layers', labArtificialBasis.run],
    ['pair', 'Прямая и двойственная', 'arrow-left-right', labPrimalDual.run],
    ['dual', 'Двойственный симплекс', 'arrow-down-up', labDualSimplex.run],
    ['transport', 'Транспортная задача', 'truck', labTransport.run],
    ['stability', 'Проверка устойчивости', 'sliders-horizontal', labStability.run],
  ];

  const runMethod = new Map(methods.map(([key, , , run]) => [key, run]));

  const byId = id => document.getElementById(id);
  const editor = byId('editor');
  const error = byId('error');
  const solve = byId('solve');
  const copy = byId('copy');
  const save = byId('save');
  const nav = new Map();
  const workspace = document.querySelector('.workspace');
  const viewButtons = [...byId('view-switch').querySelectorAll('button')];
  const panelBodies = [byId('form-content'), byId('result-content')];
  const offsets = [0, 0];
  let splitOffset = 0;

  function setView(view) {
    const previous = workspace.dataset.view;
    if (view === previous) return;
    if (previous === 'split') splitOffset = workspace.scrollTop;
    panelBodies.forEach((body, index) => {
      const panel = body.closest('.panel');
      if (!panel.hidden && getComputedStyle(body).overflowY === 'auto') offsets[index] = body.scrollTop;
      panel.hidden = view !== 'split' && panel.id !== view;
    });
    workspace.dataset.view = view;
    workspace.scrollTop = view === 'split' ? splitOffset : 0;
    panelBodies.forEach((body, index) => {
      if (!body.closest('.panel').hidden) body.scrollTop = offsets[index];
    });
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }

  for (const button of viewButtons) button.addEventListener('click', () => setView(button.dataset.view));

  let method = 'simplex';
  let lp = example('simplex');
  let tp = example('transport');
  let optimalityProblem = example('optimality');
  let result = null;
  let selectedExample = 0;
  let revision = 0;

  const checking = () => method === 'optimality';
  const action = () => checking() ? 'Проверить' : 'Решить';
  const data = () => checking() ? optimalityProblem : method === 'transport' ? tp : lp;
  function setData(value) {
    if (checking()) optimalityProblem = value;
    else if (method === 'transport') tp = value;
    else lp = value;
  }

  function invalidate() {
    revision += 1;
    result = null;
    error.hidden = true;
    solve.disabled = false;
    solve.textContent = action();
    copy.disabled = save.disabled = true;
    copy.textContent = 'Копировать';
    save.textContent = 'Сохранить .txt';
    byId('answer').hidden = true;
    byId('empty').hidden = false;
    byId('placeholder').textContent = checking()
      ? 'Введите условие и заданный план, затем нажмите «Проверить».'
      : 'Введите условие и нажмите «Решить».';
    byId('announcement').textContent = '';
  }

  function dimension(label, index, maximum) {
    const container = element('div', undefined, { class: 'control' });
    const value = shape(data())[index];
    const group = element('div', undefined, { class: 'stepper', role: 'group', 'aria-label': label });
    const buttons = [-1, 1].map(change => {
      const id = 'dimension-' + index + '-' + change;
      const button = element('button', change < 0 ? '−' : '+', {
        id, type: 'button', 'aria-label': (change < 0 ? 'Уменьшить' : 'Увеличить') + ' число: ' + label.toLowerCase(),
      });
      button.disabled = change < 0 ? value === 1 : value === maximum;
      button.addEventListener('click', () => {
        const size = shape(data());
        size[index] += change;
        setData(resize(data(), ...size));
        selectedExample = null;
        invalidate();
        renderForm();
        const replacement = byId(id);
        (replacement.disabled ? byId('dimension-' + index + '-' + (-change)) : replacement).focus();
      });
      return button;
    });
    group.append(buttons[0], element('output', String(value), { 'aria-label': label }), buttons[1]);
    container.append(element('span', label), group);
    return container;
  }

  function renderForm() {
    const transport = method === 'transport';
    const view = fields(data());
    const option = element('label', view.optionLabel, { class: 'control' });
    option.append(view.option);
    byId('options').replaceChildren(option);
    byId('dimensions').replaceChildren(
      dimension(transport ? 'Поставщики' : 'Ограничения', 0, transport ? 30 : 40),
      dimension(transport ? 'Потребители' : 'Переменные', 1, 30),
    );
    byId('matrix').replaceChildren(...view.tables);
    byId('hint').textContent = view.hint ?? '';
    byId('hint').hidden = !transport;
    updateExamples();
  }

  function choose(key) {
    method = key;
    const [, label] = methods.find(item => item[0] === key);
    byId('title').textContent = label;
    for (const [id, button] of nav) button.setAttribute('aria-current', String(id === key));
    invalidate();
    renderForm();
  }

  function showAnswer(answer) {
    result = answer;
    const status = byId('status');
    status.textContent = answer.message;
    status.dataset.state = answer.status;
    const formulas = byId('formulas');
    formulas.replaceChildren(...answer.summary.map((block, i) =>
      labReport.math(block, i === 0 ? 'value' : 'plan')));
    formulas.hidden = answer.summary.length === 0;
    const report = byId('report');
    report.replaceChildren(labReport.render(answer.report));
    byId('answer').hidden = false;
    offsets[1] = 0;
    byId('result-content').scrollTop = 0;
    byId('empty').hidden = true;
    byId('announcement').textContent = answer.message;
    copy.disabled = save.disabled = false;
  }

  for (const [key, label, glyph] of methods) {
    const button = element('button', undefined, { type: 'button' });
    button.append(element('img', undefined, { class: 'glyph', src: 'vendor/lucide/' + glyph + '.svg', alt: '' }), label);
    button.addEventListener('click', () => { if (method !== key) { selectedExample = null; choose(key); } });
    nav.set(key, button);
    byId('methods').append(button);
  }

  const exampleButtons = [0, 1, 2].map(index => {
    const button = element('button', String(index + 1), { type: 'button' });
    button.addEventListener('click', () => {
      setData(example(method, index));
      selectedExample = index;
      invalidate();
      renderForm();
      byId('announcement').textContent = 'Загружен пример ' + (index + 1) + '.';
    });
    byId('examples').append(button);
    return button;
  });

  function updateExamples() {
    exampleButtons.forEach((button, index) => {
      const label = exampleLabel(method, index);
      button.setAttribute('aria-label', 'Пример ' + (index + 1) + '. ' + label);
      button.setAttribute('aria-pressed', String(index === selectedExample));
      button.title = label;
    });
  }

  byId('clear').addEventListener('click', () => {
    selectedExample = null;
    setData(resize(data(), ...shape(data()), true));
    invalidate();
    renderForm();
    byId('announcement').textContent = 'Коэффициенты сброшены.';
  });
  editor.addEventListener('input', () => {
    selectedExample = null;
    updateExamples();
    invalidate();
  });
  editor.addEventListener('submit', async event => {
    event.preventDefault();
    invalidate();
    const request = revision;
    solve.disabled = true;
    solve.textContent = checking() ? 'Проверяем…' : 'Решаем…';
    byId('placeholder').textContent = checking() ? 'Проверяем план…' : 'Строим решение…';
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (request !== revision) return;
    try {
      showAnswer(runMethod.get(method)(data()));
    } catch (failure) {
      error.textContent = failure.message || 'Не удалось выполнить расчёт.';
      error.hidden = false;
      byId('placeholder').textContent = 'Проверьте введённые данные.';
    } finally {
      if (request === revision) {
        solve.disabled = false;
        solve.textContent = action();
      }
    }
  });

  copy.addEventListener('click', async () => {
    const previous = result;
    try {
      if (!await bridge.copy.postMessage(previous.export)) throw new Error('copy');
      if (previous === result) copy.textContent = 'Скопировано';
    } catch {
      if (previous === result) byId('announcement').textContent = 'Копирование недоступно. Отчёт можно сохранить.';
      if (previous === result) copy.textContent = 'Не скопировано';
    }
  });
  save.addEventListener('click', async () => {
    try {
      if (await bridge.save.postMessage(result.export)) byId('announcement').textContent = 'Отчёт сохранён.';
    } catch {
      byId('announcement').textContent = 'Не удалось сохранить отчёт.';
      save.textContent = 'Повторить сохранение';
    }
  });

  choose(method);
})();
