const test = require('node:test');
const assert = require('node:assert/strict');

const { readFileSync } = require('node:fs');
const { createContext, runInContext } = require('node:vm');
const html = readFileSync(require.resolve('../ui/index.html'), 'utf8');
const methodScripts = [...html.matchAll(/src="(methods\/[^"]+)"/g)].map(match => match[1]);
for (const script of methodScripts) {
  require(`../ui/${script}`);
}
require('../ui/examples.js');

const sections = {
  simplex: labSimplex,
  dual: labDualSimplex,
  artificial: labArtificialBasis,
  optimality: labOptimality,
  pair: labPrimalDual,
  transport: labTransport,
  stability: labStability,
};
const calculate = ({ method, ...data }) => sections[method].run(data);

const example = (method, index) => calculate({ method, ...labExamples.example(method, index) });
const solve = (method, c, A, b, signs, sense = 'max', plan) => calculate({ method, c, A, b, signs, sense, plan });

test('каждая вкладка запускается без файлов остальных методов', () => {
  const shared = methodScripts.filter(script => script.startsWith('methods/shared/'));
  const sectionFiles = [
    ['simplex', 'simplex', 'labSimplex'],
    ['optimality', 'optimality', 'labOptimality'],
    ['artificial', 'artificial-basis', 'labArtificialBasis'],
    ['pair', 'primal-dual', 'labPrimalDual'],
    ['dual', 'dual-simplex', 'labDualSimplex'],
    ['transport', 'transport', 'labTransport'],
    ['stability', 'stability', 'labStability'],
  ];

  for (const [method, file, globalName] of sectionFiles) {
    const isolated = createContext({});
    for (const script of [...shared, `methods/${file}.js`]) {
      const source = readFileSync(require.resolve(`../ui/${script}`), 'utf8');
      runInContext(source, isolated, { filename: script });
    }

    for (const index of [0, 1, 2]) {
      const data = labExamples.example(method, index);
      const run = isolated[globalName].run;
      if (method === 'transport' && index === 2) {
        assert.throws(() => run(data), /не могут быть отрицательными/);
      } else {
        assert.equal(JSON.stringify(run(data)), JSON.stringify(example(method, index)));
      }
    }
  }
});

test('прямой симплекс сохраняет итоговую таблицу принятого примера', () => {
  const answer = example('simplex', 0);
  assert.deepEqual(answer.x, ['2', '2']);
  assert.equal(answer.value, '10');
  assert.match(answer.export, /δ = \(2; 2; 1\)/);
  assert.match(answer.export, /Δ = \(1; 2\)/);
  assert.equal(example('simplex', 2).status, 'infeasible');
});

test('симплекс на исходной задаче из разбора контрольной', () => {
  const answer = solve('simplex', [2, -1, 3, 1, 0],
    [[2, 1, -3, 0, 0], [1, 0, 1, 1, 0], [3, 0, 2, 0, -1]], [10, 7, -4], ['=', '=', '=']);
  assert.equal(answer.value, '74/5');
  assert.deepEqual(answer.x, ['31/5', '0', '4/5', '0', '121/5']);
  const tables = answer.report.filter(block => block.kind === 'table');
  assert.equal(tables[0].pivot.length, 2);
  const last = tables[tables.length - 1];
  assert.equal(last.rows[last.rows.length - 1][last.headers.indexOf('x2')], '4/5');
});

test('метод искусственного базиса проходит две фазы и удаляет зависимое ограничение', () => {
  const answer = example('artificial', 0);
  assert.equal(answer.value, '32/3');
  assert.deepEqual(answer.x, ['10/3', '2/3', '0']);
  assert.match(answer.export, /Фаза I: f\(x, w\)/);
  const secondPhase = answer.export.split('Фаза II: таблица без W')[1];
  assert.ok(secondPhase);
  assert.doesNotMatch(secondPhase, /W[0-9]/);
  assert.match(example('artificial', 1).export, /Удаляем зависимое ограничение/);
  assert.equal(example('artificial', 2).status, 'infeasible');
});

test('двойственный симплекс выбирает ведущий элемент и учитывает замену переменных', () => {
  const direct = example('dual', 0);
  assert.deepEqual(direct.x, ['0', '2', '5', '1']);
  assert.equal(direct.value, '-7');
  assert.match(direct.export, /Ведущая строка x5.*Ведущий столбец x2.*-1\/3/);
  const shifted = example('dual', 1);
  assert.equal(shifted.value, '19/2');
  assert.deepEqual(shifted.x, ['9/2', '1/2']);
  assert.match(shifted.export, /x1 = 5 − x1′/);
  assert.equal(example('dual', 2).status, 'infeasible');
  const unbounded = solve('dual', [1, 1], [[0, 1]], [1], ['<=']);
  assert.equal(unbounded.status, 'unbounded');
});

test('оба симплексных маршрута распознают повтор базиса', () => {
  assert.match(example('simplex', 1).export, /Переход к правилу Бланда/);
  const dual = solve('dual', [0, 0, -1],
    [['-1/2', '-1/2', -1], ['11/2', '3/2', 0], ['5/2', '1/2', 0], [-9, -1, 0]],
    [-10, 57, 9, 24], ['<=', '<=', '<=', '<=']);
  assert.equal(dual.value, '-1');
  assert.match(dual.export, /Переход к правилу Бланда/);
});

test('двойственный план получается двумя способами даже после удаления зависимой строки', () => {
  const answer = example('pair', 0);
  assert.match(answer.export, /Способ 1/);
  assert.match(answer.export, /Способ 2/);
  assert.equal(answer.export.match(/y\* = \(1\/4; 5\/4; 0\)/g).length, 2);
  assert.match(answer.export, /f = 21\/2; g = 21\/2/);
  const redundant = solve('pair', [1, 1], [[1, 1], [2, 2]], [3, 6], ['=', '=']);
  assert.match(redundant.export, /Оба способа дали один вектор/);
  assert.equal(example('pair', 2).status, 'unbounded');
});

test('проверка плана воспроизводит два вывода разбора контрольной', () => {
  const optimal = example('optimality', 0);
  assert.equal(optimal.status, 'optimal');
  assert.deepEqual(optimal.y, ['0', '0', '1']);
  assert.match(optimal.export, /J = \{1, 2\}/);
  assert.match(optimal.export, /I = \{1, 2\}/);
  assert.equal(optimal.value, '4');
  const rejected = example('optimality', 1);
  assert.deepEqual(rejected.y, ['0', '2', '0']);
  assert.equal(rejected.status, 'basis_not_optimal');
  assert.equal(example('optimality', 2).status, 'basis_infeasible');
});

test('проверка плана различает несовместность, минимум и свободные двойственные компоненты', () => {
  const min = solve('optimality', [2], [[1], [1]], [3, 5], ['>=', '<='], 'min', [3]);
  assert.equal(min.status, 'optimal');
  assert.deepEqual(min.y, ['2', '0']);
  const family = solve('optimality', [1], [[1], [1]], [1, 1], ['>=', '<='], 'max', [1]);
  assert.equal(family.status, 'optimal');
  assert.deepEqual(family.y, ['0', '1']);
  assert.match(family.export, /подобрать их с учётом всех двойственных условий/);
  const impossible = solve('optimality', [1], [[1]], [2], ['<='], 'max', [1]);
  assert.equal(impossible.status, 'basis_not_optimal');
  assert.match(impossible.export, /систем[аы].*несовместна/i);
  const noFeasibleMember = solve('optimality', [1], [[1], [1]], [1, 1], ['>=', '>='], 'max', [1]);
  assert.equal(noFeasibleMember.status, 'basis_not_optimal');
  const interior = solve('optimality', [0], [[1]], [3], ['<='], 'max', ['3/2']);
  assert.equal(interior.status, 'optimal');
  const negative = solve('optimality', [0], [[1]], [3], ['<='], 'max', [-1]);
  assert.equal(negative.status, 'basis_infeasible');
  assert.match(negative.export, /Отрицательные компоненты/);
});

test('перевозки работают с дробным запасом, фиктивным узлом и обеими инициализациями', () => {
  assert.equal(example('transport', 0).value, '1220');
  const problem = labExamples.example('transport', 1);
  const least = calculate({ method: 'transport', ...problem });
  const northwest = calculate({ method: 'transport', ...problem, initial: 'northwest' });
  assert.equal(least.value, '45/2');
  assert.equal(northwest.value, least.value);
  assert.match(least.export, /фиктивный поставщик/);
  assert.match(northwest.export, /Звёздочка/);
  assert.throws(() => example('transport', 2), /не могут быть отрицательными/);
});

test('интервалы устойчивости учитывают зависимые строки и направление цели', () => {
  const standard = example('stability', 0);
  assert.match(standard.export, /c1 = 3: \[2; \+∞\]/);
  assert.match(standard.export, /b1 = 4: \[2; 5\]/);
  const redundant = example('stability', 1);
  assert.match(redundant.export, /b1 = 3: \[3; 3\]/);
  assert.match(redundant.export, /b2 = 6: \[6; 6\]/);
  const minimum = solve('stability', [1], [[-1], [1]], [-2, 6], ['<=', '<='], 'min');
  assert.match(minimum.export, /c1 = 1: \[0; \+∞\]/);
  assert.match(minimum.export, /b1 = -2: \[-6; 0\]/);
});

test('точность дробей, максимальный размер и ошибки ввода', () => {
  const data = { method: 'simplex', A: [[1]], c: ['1,25'], b: ['1/2'], signs: ['≤'] };
  const result = calculate(data);
  assert.equal(result.value, '5/8');
  assert.ok(result.report.some(item => item.latex?.includes('\\frac{5}{8}')));
  for (const patch of [{ A: [] }, { c: [''] }, { b: ['0/0'] }, { c: ['1e99999999'] }, { A: [[null]] },
    { signs: ['!'] }, { c: ['NaN'] }, { method: 'optimality', plan: [] }]) {
    assert.throws(() => calculate({ ...data, ...patch }));
  }
  assert.equal(String(labMath.number('−1_2,50e-1', 'Число')), '-5/4');
  const matrix = Array.from({ length: 40 }, (_, i) => Array.from({ length: 30 }, (_, j) => Number(i === j)));
  assert.equal(solve('simplex', Array(30).fill(1), matrix, Array(40).fill(1), Array(40).fill('<=')).value, '30');
});
