import { PriorityQueue } from '../src/index.js';

test('pops in order', () => {
  const q = new PriorityQueue();
  q.push(3);
  q.push(1);
  expect(q.pop()).toBe(1);
});
