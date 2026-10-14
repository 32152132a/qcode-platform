// Keep native form values and change handlers; enhance only the visible control.
export function initializeSelects(root = document.body) {
  if (!HTMLElement.prototype.showPopover) return;
  const controls = new WeakMap();
  function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const wrapper = document.createElement('span'); wrapper.className = 'ui-select';
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'ui-select-trigger';
    const text = document.createElement('span'), arrow = document.createElement('span'); arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
    const menu = document.createElement('div'); menu.className = 'ui-select-menu'; menu.popover = 'auto'; menu.setAttribute('role', 'listbox');
    menu.id = `qcode-select-${crypto.randomUUID()}`;
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-controls', menu.id); trigger.setAttribute('aria-expanded', 'false');
    trigger.append(text, arrow); select.before(wrapper); wrapper.append(select, trigger, menu);
    select.classList.add('ui-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    function sync() {
      text.textContent = select.selectedOptions[0]?.textContent || '请选择'; trigger.disabled = select.disabled;
      const label = select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim() || '选择';
      trigger.setAttribute('aria-label', `${label}：${text.textContent}`);
      if (select.disabled && menu.matches(':popover-open')) menu.hidePopover();
    }
    function render() {
      menu.replaceChildren();
      for (const option of select.options) {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'ui-select-option'; item.setAttribute('role', 'option');
        item.textContent = option.textContent; item.disabled = option.disabled || option.parentElement.disabled; item.hidden = option.hidden;
        item.setAttribute('aria-selected', String(option.selected));
        item.onclick = () => { select.value = option.value; select.dispatchEvent(new Event('input', {bubbles:true})); select.dispatchEvent(new Event('change', {bubbles:true})); menu.hidePopover(); trigger.focus(); };
        menu.append(item);
      }
    }
    function open() {
      render(); const rect = trigger.getBoundingClientRect();
      menu.style.width = `${rect.width}px`; menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`;
      const space = innerHeight - rect.bottom - 12, above = space < 160 && rect.top > space;
      menu.style.maxHeight = `${Math.max(80, Math.min(280, above ? rect.top - 12 : space))}px`;
      menu.style.top = above ? 'auto' : `${rect.bottom + 6}px`; menu.style.bottom = above ? `${innerHeight - rect.top + 6}px` : 'auto';
      menu.showPopover(); (menu.querySelector('[aria-selected=true]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
    }
    trigger.onclick = () => menu.matches(':popover-open') ? menu.hidePopover() : open();
    trigger.onkeydown = event => { if (['ArrowDown','ArrowUp'].includes(event.key)) {event.preventDefault();open();} };
    menu.onkeydown = event => {
      const items = [...menu.querySelectorAll('button:not(:disabled):not([hidden])')], index = items.indexOf(document.activeElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {event.preventDefault();const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}
      if (event.key === 'Escape' || event.key === 'Tab') {menu.hidePopover();if(event.key==='Escape'){event.preventDefault();trigger.focus();}}
    };
    menu.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
    select.addEventListener('change', sync); select.addEventListener('invalid', () => trigger.focus());
    // Existing editors assign select.value directly when presets change.
    for (const property of ['value','selectedIndex']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
      Object.defineProperty(select, property, {configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
    }
    controls.set(select, sync); sync();
  }
  root.querySelectorAll('select').forEach(enhance);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.target.closest?.('.ui-select-menu,.ui-select-trigger')) continue;
      const select = record.target instanceof HTMLSelectElement ? record.target : record.target.closest?.('select');
      if (select && controls.has(select)) controls.get(select)();
      for (const node of record.addedNodes) if (node.nodeType === 1 && !node.closest('.ui-select-menu,.ui-select-trigger')) {
        if (node.matches('select')) enhance(node); node.querySelectorAll('select').forEach(enhance);
      }
    }
  }).observe(root, {subtree:true,childList:true,attributes:true,attributeFilter:['disabled','selected','label']});
  root.addEventListener('reset', () => setTimeout(() => root.querySelectorAll('select').forEach(select => controls.get(select)?.()), 0));
}
