globalThis.labMath = (() => {
  function gcd(first, second) {
    while (second !== 0n) [first, second] = [second, first % second];
    return first < 0n ? -first : first;
  }

  class Fraction {
    constructor(numerator, denominator = 1n) {
      if (denominator === 0n) throw new Error('Знаменатель должен быть ненулевым.');

      const denominatorSign = denominator < 0n ? -1n : 1n;
      const divisor = gcd(numerator, denominator) * denominatorSign;
      this.numerator = numerator / divisor;
      this.denominator = denominator / divisor;
    }

    get sign() {
      if (this.numerator === 0n) return 0;
      return this.numerator < 0n ? -1 : 1;
    }

    compare(other) {
      const left = this.numerator * other.denominator;
      const right = other.numerator * this.denominator;

      if (left === right) return 0;
      return left < right ? -1 : 1;
    }

    plus(other) {
      const numerator = this.numerator * other.denominator + other.numerator * this.denominator;
      const denominator = this.denominator * other.denominator;
      return new Fraction(numerator, denominator);
    }

    minus(other) {
      return this.plus(other.negate());
    }

    times(other) {
      return new Fraction(this.numerator * other.numerator, this.denominator * other.denominator);
    }

    over(other) {
      return new Fraction(this.numerator * other.denominator, this.denominator * other.numerator);
    }

    negate() {
      return new Fraction(-this.numerator, this.denominator);
    }

    toString() {
      return this.denominator === 1n ? String(this.numerator) : `${this.numerator}/${this.denominator}`;
    }
  }

  const zero = new Fraction(0n);
  const one = new Fraction(1n);
  const format = value => value === null ? '∞' : String(value);

  function number(value, label) {
    if (typeof value !== 'string' && !Number.isSafeInteger(value)) {
      throw new Error(`${label}. Введите число.`);
    }
    const input = String(value).trim().replaceAll('−', '-').replace(',', '.');
    if (input.length > 80) throw new Error(`${label}. Используйте число длиной до 80 знаков.`);

    const text = input.replace(/(\d)_(?=\d)/g, '$1');
    const ratio = /^([+-]?\d+)\/(\d+)$/.exec(text);
    if (ratio) {
      const numerator = BigInt(ratio[1]);
      const denominator = BigInt(ratio[2]);
      if (denominator === 0n) throw new Error(`${label}. Знаменатель должен быть ненулевым.`);
      return new Fraction(numerator, denominator);
    }

    const decimal = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!decimal || !(decimal[2] || decimal[3])) {
      throw new Error(`${label}. Некорректное число: «${input.slice(0, 60)}».`);
    }
    const [, sign, whole, fractional = '', power = '0'] = decimal;
    const exponent = Number(power);
    if (Math.abs(exponent) > 60) throw new Error(`${label}. Слишком большая степень числа.`);

    const digits = BigInt(sign + whole + fractional);
    const scale = fractional.length - exponent;
    if (scale < 0) {
      return new Fraction(digits * 10n ** BigInt(-scale));
    }
    return new Fraction(digits, 10n ** BigInt(scale));
  }

  return { zero, one, format, number };
})();
