// Run in the hidden print view before it prints. WebKit does not repeat a table's header row on the
// pages a long table runs on to, as a browser's print does: such a table is cut here into one table a
// page, each with the header row, the rest starting a page of its own. PAGE_MM is the height of a
// page inside its margins.
(() => {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:${PAGE_MM}mm`;
  document.body.appendChild(probe);
  const page = probe.getBoundingClientRect().height - 2;
  probe.remove();
  for (const section of [...document.querySelectorAll('section.list')]) {
    const table = section.querySelector('table');
    const rows = [...table.tBodies[0].rows];
    const head = table.tHead.getBoundingClientRect().height;
    // The first page has the list's title above the table.
    let room = page - (table.getBoundingClientRect().top - section.getBoundingClientRect().top) - head;
    const pages = [[]];
    for (const row of rows) {
      const h = row.getBoundingClientRect().height;
      if (h > room && pages[pages.length - 1].length) {
        pages.push([]);
        room = page - head;
      }
      pages[pages.length - 1].push(row);
      room -= h;
    }
    let after = section;
    for (const part of pages.slice(1)) {
      const next = document.createElement('section');
      next.className = 'list';
      const copy = table.cloneNode(false);
      for (const el of table.children) if (el !== table.tBodies[0]) copy.appendChild(el.cloneNode(true));
      const body = document.createElement('tbody');
      for (const row of part) body.appendChild(row);
      copy.appendChild(body);
      next.appendChild(copy);
      after.after(next);
      after = next;
    }
  }
})();
