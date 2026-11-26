globalThis.labReport = (() => {
  const { element } = labForms;

  function math(block, className = 'formula') {
    const node = element('div', undefined, { class: className });
    try {
      const expression = element('span');
      katex.render(block.latex, expression, { throwOnError: true });
      node.append(block.prefix, expression, block.suffix);
    } catch {
      node.textContent = block.text;
    }
    return node;
  }

  function render(items) {
    const content = document.createDocumentFragment();
    for (const item of items) {
      if (item.kind === 'table') content.append(labTables.render(item));
      else if (item.kind === 'formula') content.append(math(item));
      else {
        const tags = { heading: 'h3', step: 'h4', text: 'p' };
        content.append(element(tags[item.kind], item.text));
      }
    }
    return content;
  }
  return { math, render };
})();
