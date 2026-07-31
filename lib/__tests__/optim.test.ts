import { describe, expect, it } from 'vitest';
import { nelderMead } from '../optim';

describe('nelderMead', () => {
  it('finds the minimum of a simple quadratic', () => {
    const f = (x: number[]) => (x[0] - 3) ** 2 + (x[1] + 2) ** 2 + 5;
    const result = nelderMead(f, [0, 0]);

    expect(result.x[0]).toBeCloseTo(3, 4);
    expect(result.x[1]).toBeCloseTo(-2, 4);
    expect(result.fx).toBeCloseTo(5, 4);
    expect(result.converged).toBe(true);
  });

  it('gets close to the minimum of the Rosenbrock function', () => {
    const rosenbrock = (x: number[]) => (1 - x[0]) ** 2 + 100 * (x[1] - x[0] ** 2) ** 2;
    const result = nelderMead(rosenbrock, [-1, 1], { maxIter: 5000 });

    expect(result.x[0]).toBeCloseTo(1, 2);
    expect(result.x[1]).toBeCloseTo(1, 2);
    expect(result.fx).toBeLessThan(1e-4);
  });

  it('throws on an empty starting point', () => {
    expect(() => nelderMead(() => 0, [])).toThrow(/non-empty/);
  });
});
