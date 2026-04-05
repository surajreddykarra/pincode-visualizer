/**
 * Search Module - OTP-style 6-digit PIN input
 * Handles keyboard navigation, auto-advance, backspace, and prefix change events.
 */
const Search = (() => {
  const inputs = [];
  let currentPrefix = '';

  function init() {
    const slots = document.querySelectorAll('.pin-slot input');
    slots.forEach((input, i) => {
      inputs.push(input);

      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        if (val.length > 0) {
          input.value = val.charAt(val.length - 1);
          input.classList.add('filled');
          // Auto-advance to next input
          if (i < 5) {
            inputs[i + 1].focus();
          } else {
            input.blur(); // last digit - remove focus
          }
        } else {
          input.value = '';
          input.classList.remove('filled');
        }
        emitChange();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (input.value === '' && i > 0) {
            // Move to previous input and clear it
            inputs[i - 1].value = '';
            inputs[i - 1].classList.remove('filled');
            inputs[i - 1].focus();
            e.preventDefault();
          } else {
            input.value = '';
            input.classList.remove('filled');
          }
          // Small delay to let the DOM update before emitting
          setTimeout(emitChange, 0);
        } else if (e.key === 'ArrowLeft' && i > 0) {
          inputs[i - 1].focus();
          e.preventDefault();
        } else if (e.key === 'ArrowRight' && i < 5) {
          inputs[i + 1].focus();
          e.preventDefault();
        } else if (e.key === 'Escape') {
          clearAll();
        } else if (e.key >= '0' && e.key <= '9') {
          // Let input event handle it
        } else if (e.key === 'Tab') {
          // Allow default tab behavior
        } else if (!e.ctrlKey && !e.metaKey) {
          // Block non-numeric input
          if (e.key.length === 1) e.preventDefault();
        }
      });

      input.addEventListener('focus', () => {
        input.select();
        // Add active state to slot
        input.parentElement.classList.add('active');
      });

      input.addEventListener('blur', () => {
        input.parentElement.classList.remove('active');
      });

      // Handle paste
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!pasted) return;
        for (let j = 0; j < pasted.length && (i + j) < 6; j++) {
          inputs[i + j].value = pasted[j];
          inputs[i + j].classList.add('filled');
        }
        const nextIdx = Math.min(i + pasted.length, 5);
        inputs[nextIdx].focus();
        emitChange();
      });
    });

    // Focus first input on page load (after a small delay for map init)
    setTimeout(() => inputs[0].focus(), 500);
  }

  function emitChange() {
    let prefix = '';
    for (let i = 0; i < 6; i++) {
      if (inputs[i].value === '') break;
      prefix += inputs[i].value;
    }
    if (prefix !== currentPrefix) {
      currentPrefix = prefix;
      if (typeof window.onPinPrefixChange === 'function') {
        window.onPinPrefixChange(prefix);
      }
    }
  }

  function clearAll() {
    inputs.forEach(inp => {
      inp.value = '';
      inp.classList.remove('filled');
    });
    inputs[0].focus();
    emitChange();
  }

  // Programmatic set (e.g., from legend click)
  function setPrefix(prefix) {
    for (let i = 0; i < 6; i++) {
      if (i < prefix.length) {
        inputs[i].value = prefix[i];
        inputs[i].classList.add('filled');
      } else {
        inputs[i].value = '';
        inputs[i].classList.remove('filled');
      }
    }
    if (prefix.length < 6) {
      inputs[prefix.length].focus();
    }
    emitChange();
  }

  function getPrefix() {
    return currentPrefix;
  }

  return { init, clearAll, setPrefix, getPrefix };
})();
