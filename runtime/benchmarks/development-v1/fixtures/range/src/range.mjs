export function sumInclusive(start, end) {
  let sum = 0;
  for (let value = start; value < end; value++) sum += value;
  return sum;
}
