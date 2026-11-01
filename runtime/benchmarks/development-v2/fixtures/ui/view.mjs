export function filterItems(items, query) {
  return items.filter(item => item.name.includes(query));
}
export function renderItems(root, items) {
  root.querySelector('ul').innerHTML = items.map(item => `<li>${item.name}</li>`).join('');
  root.querySelector('[role=status]').textContent = `${items.length} results`;
  root.querySelector('#empty').hidden = false;
}
