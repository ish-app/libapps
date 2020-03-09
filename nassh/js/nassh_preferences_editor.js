// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * CSP means that we can't kick off the initialization from the html file,
 * so we do it like this instead.
 */
window.addEventListener('DOMContentLoaded', (event) => {
  // Modifications if crosh is running as chrome://terminal.
  if (location.href.startsWith('chrome://terminal/')) {
    lib.registerInit('terminal-private-storage', (onInit) => {
      hterm.defaultStorage = new lib.Storage.TerminalPrivate(onInit);
    });
    lib.registerInit('messages', nassh.loadMessages);
    // Polyfill chrome.runtime.getManifest since it is not available when
    // running as chrome://terminal.  We require name, version, and icons.
    chrome.runtime.getManifest = () => {
      return {
        'name': 'Terminal',
        'version': 'system',
        'icons': {'192': '/images/dev/crostini-192.png'},
      };
    };
  }

  function setupPreferences() {
    var manifest = chrome.runtime.getManifest();

    // Create a local hterm instance so people can see their changes live.
    var term = new hterm.Terminal();
    term.onTerminalReady = function() {
        var io = term.io.push();
        io.onVTKeystroke = io.print;
        io.sendString = io.print;
        io.println('# ' + nassh.msg('WELCOME_VERSION',
                                    [manifest.name, manifest.version]));
        io.print('$ ./configure && make && make install');
        term.setCursorVisible(true);
      };
    term.decorate(lib.notNull(document.querySelector('#terminal')));
    term.installKeyboard();
    term.contextMenu.setItems([
      {name: nassh.msg('TERMINAL_CLEAR_MENU_LABEL'),
       action: function() { term.wipeContents(); }},
      {name: nassh.msg('TERMINAL_RESET_MENU_LABEL'),
       action: function() { term.reset(); }},
    ]);

    // Useful for console debugging.
    window.term_ = term;

    var prefsEditor = new nassh.PreferencesEditor();

    var a = document.querySelector('#backup');
    a.download = nassh.msg('PREF_BACKUP_FILENAME');
    a.onclick = prefsEditor.onBackupClick.bind(prefsEditor);
    prefsEditor.updateBackupLink();

    a = document.querySelector('#restore');
    a.onclick = prefsEditor.onRestoreClick.bind(prefsEditor);

    // Set up labels.
    var eles = document.querySelectorAll('[i18n-content]');
    for (var i = 0; i < eles.length; ++i) {
      var ele = eles[i];
      var attr = ele.getAttribute('i18n-content');
      var text;
      if (attr.substr(0, 8) == 'manifest') {
        text = manifest[attr.substr(9)];
      } else {
        text = nassh.msg(attr);
      }
      if (text !== undefined) {
        ele.innerText = text;
      }
    }

    // Set up icon on the left side.
    // Start with 128px, but if it's not available, scale the highest available.
    const icon = document.getElementById('icon');
    let size = '128';
    icon.style.width = `${size}px`;
    if (!manifest.icons.hasOwnProperty(size)) {
      // Sort the keys in descending numeric order.
      const keys = Object.keys(manifest.icons).map((x) => parseInt(x, 10)).sort(
          (a, b) => a < b ? 1 : -1);
      size = keys[0];
    }
    icon.src = lib.f.getURL(`${manifest.icons[size]}`);

    // Set up reset button.
    document.getElementById('reset').onclick = function() {
        prefsEditor.resetAll();
      };

    // Set up profile selection field.
    var profile = lib.notNull(document.getElementById('profile'));
    profile.oninput = function() {
        nassh.PreferencesEditor.debounce(profile, function(input) {
            prefsEditor.notify(nassh.msg('LOADING_LABEL'), 500);
            if (input.value.length)
              prefsEditor.selectProfile(input.value);
          });
      };
    profile.value = nassh.msg('FIELD_TERMINAL_PROFILE_PLACEHOLDER');

    // Allow people to reset individual fields by pressing escape.
    document.onkeyup = function(e) {
        if (document.activeElement.name == 'settings' && e.keyCode == 27)
          prefsEditor.reset(document.activeElement);
      };
  }

  lib.init(setupPreferences);
});

/**
 * Class for editing hterm profiles.
 *
 * @param {string=} profileId Profile name to read settings from.
 * @constructor
 */
nassh.PreferencesEditor = function(profileId = 'default') {
  this.selectProfile(profileId);
};

/**
 * Debounce action on input element.
 *
 * This way people can type up a setting before seeing an update.
 * Useful with settings such as font names or sizes.
 *
 * @param {!Element} input An HTML input element to pass down to
 *     callback.
 * @param {function(!Element)} callback Function to call after
 *     debouncing while passing it the input object.
 * @param {number=} timeout Optional how long to debounce.
 */
nassh.PreferencesEditor.debounce = function(input, callback, timeout = 500) {
  clearTimeout(input.timeout);
  input.timeout = setTimeout(function() {
      callback(input);
      input.timeout = null;
    }, timeout);
};

/**
 * Select a profile for editing.
 *
 * This will load the settings and update the HTML display.
 *
 * @param {string} profileId The profile name to read settings from.
 */
nassh.PreferencesEditor.prototype.selectProfile = function(profileId) {
  window.term_.setProfile(profileId);
  var prefsEditor = this;
  var prefs = new hterm.PreferenceManager(profileId);
  this.prefs_ = prefs;
  prefs.readStorage(function() {
      prefs.notifyAll();
      prefsEditor.syncPage();
    });
};

/**
 * Attached to the onclick handler of the "Save Backup" link.
 *
 * A click generated by the user causes us to update the href attribute of this
 * anchor tag.  This happens asynchronously because we have to read prefs from
 * chrome.storage.sync (via the PreferenceManager.)  We cancel the user's
 * original click but generate a synthetic click once the preferences are known
 * to us.
 *
 * @param {?Event} e
 */
nassh.PreferencesEditor.prototype.onBackupClick = function(e) {
  // If we generated this event, just let it happen.
  if (!e || e.synthetic)
    return;

  this.updateBackupLink(function() {
    var event = new MouseEvent(e.type, e);
    event.synthetic = true;
    e.target.dispatchEvent(event);
  });

  e.preventDefault();
};

/**
 * Attached to the onclick handler of the "Restore Backup" link.
 *
 * This presents a file chooser dialog to let the user select an appropriate
 * backup to restore.  Invalid backups fail silently.  Successful restores
 * cause the page to reload with the restored preference values.  Any open
 * nassh windows should immediately reflect the new preference values.
 *
 * @param {?Event} e
 */
nassh.PreferencesEditor.prototype.onRestoreClick = function(e) {
  if (e) {
    e.preventDefault();
  }
  var input = document.querySelector('input.restore');
  input.onchange = () => {
    if (input.files.length != 1)
      return;

    input.files[0].text().then((result) => {
      const obj = /** @type {!Object} */ (JSON.parse(result));
      nassh.importPreferences(obj, document.location.reload);
    });
  };

  input.click();
};

/** @param {function()=} onComplete */
nassh.PreferencesEditor.prototype.updateBackupLink = function(onComplete) {
  nassh.exportPreferences(function(value) {
    var a = document.querySelector('#backup');
    a.href = `data:text/json,${encodeURIComponent(JSON.stringify(value))}`;
    if (onComplete) {
      onComplete();
    }
  });
};

/**
 * Save the HTML color state to the preferences.
 *
 * Since the HTML5 color picker does not support alpha, we have to split
 * the rgb and alpha information across two input objects.
 *
 * @param {string} key The HTML input.id to use to locate the color input
 *     object.  By appending ':alpha' to the key name, we can also locate
 *     the range input object.
 */
nassh.PreferencesEditor.prototype.colorSave = function(key) {
  var cinput = document.getElementById(key);
  var ainput = document.getElementById(key + ':alpha');
  var rgb = lib.colors.hexToRGB(cinput.value);
  this.prefs_.set(key, lib.colors.setAlpha(
      lib.notNull(rgb), ainput.value / 100));
};

/**
 * Save the HTML state to the preferences.
 *
 * @param {!Element} input An HTML input element to update the corresponding
 *     preferences key.  Uses input.id to locate relevant preference.
 */
nassh.PreferencesEditor.prototype.save = function(input) {
  // Skip ones we don't yet handle.
  if (input.disabled)
    return;

  var keys = input.id.split(':');
  var key = keys[0];
  var prefs = this.prefs_;

  switch(this.getPreferenceType(key)) {
    case 'bool':
      prefs.set(key, input.checked);
      break;

    case 'int':
      prefs.set(key, input.value);
      break;

    case 'enum':
      prefs.set(key, JSON.parse(input.value));
      break;

    case 'tristate':
      prefs.set(key, JSON.parse(input.value));
      break;

    case 'string':
    case 'multiline-string':
      prefs.set(key, input.value);
      break;

    case 'color':
      this.colorSave(key);
      break;

    case 'url':
      prefs.set(key, input.value);
      break;

    case 'value':
    default:
      var value = input.value || 'null';
      try {
        value = JSON.parse(value);
      } catch (err) {
        this.notify(nassh.msg('JSON_PARSE_ERROR', [key, err]), 5000);
        value = prefs.get(key);
      }
      prefs.set(key, value);
      break;
  }

  console.log('New pref value for ' + key + ': ', prefs.get(key));
  this.updateBackupLink();
};

/**
 * Sync the preferences state to the HTML color objects.
 *
 * @param {string} key The HTML input.id to use to locate the color input
 *     object.  By appending ':alpha' to the key name, we can also locate
 *     the range input object.
 * @param {string} pref The preference object to get the current state from.
 * @return {?string} The rgba color information.
 */
nassh.PreferencesEditor.prototype.colorSync = function(key, pref) {
  var cinput = lib.notNull(document.getElementById(key));
  var ainput = lib.notNull(document.getElementById(key + ':alpha'));

  var rgba = lib.colors.normalizeCSS(pref);

  if (rgba) {
    cinput.value = lib.colors.rgbToHex(rgba);
    ainput.value = lib.colors.crackRGB(rgba)[3] * 100;
  } else {
    // If pref could not be normalized, then reset.
    this.reset(cinput);
    this.reset(ainput);
  }

  return rgba;
};

/**
 * Sync the preferences state to the HTML object.
 *
 * @param {!Element} input An HTML input element to update the
 *     corresponding preferences key.  Uses input.id to locate relevant
 *     preference.
 */
nassh.PreferencesEditor.prototype.sync = function(input) {
  var keys = input.id.split(':');
  var key = keys[0];
  var prefValue = this.prefs_.get(key);
  switch(this.getPreferenceType(key)) {
    case 'bool':
      input.checked = prefValue;
      break;

    case 'int':
      input.value = prefValue;
      break;

    case 'enum':
      input.value = JSON.stringify(prefValue);
      break;

    case 'tristate':
      input.value = JSON.stringify(prefValue);
      break;

    case 'string':
    case 'multiline-string':
      if (prefValue == null)
        input.value = '';
      else
        input.value = prefValue;
      break;

    case 'color':
      this.colorSync(key, prefValue);
      break;

    case 'url':
      if (prefValue == null)
        input.value = '';
      else
        input.value = prefValue;
      break;

    case 'value':
    default:
      // Use an indent for the stringify so the output is formatted somewhat
      // nicely.  Otherwise, the default output packs everything into a single
      // line and strips out all whitespace making it an unreadable mess.
      if (prefValue == null)
        input.value = '';
      else
        input.value = JSON.stringify(prefValue, null, '  ');
      break;
  }
};

/**
 * Update preferences from HTML input objects when the input changes.
 *
 * This is a helper that should be used in an event handler (e.g. onchange).
 * Should work with any input type.
 *
 * @param {!Element} input An HTML input element to update from.
 */
nassh.PreferencesEditor.prototype.onInputChange = function(input) {
  this.save(input);
  this.sync(input);
};

/**
 * Update the preferences page to reflect current preference object.
 *
 * Will basically rewrite the displayed HTML code on the fly.
 */
nassh.PreferencesEditor.prototype.syncPage = function() {
  var eles = document.getElementById('settings');

  // Clear out existing settings table.
  while (eles.hasChildNodes()) {
    eles.removeChild(eles.firstChild);
  }

  // Create the table of settings.
  for(var i = 0; i < hterm.PreferenceManager.categoryDefinitions.length; i++) {
    var categoryDefinition = hterm.PreferenceManager.categoryDefinitions[i];

    var elem = this.addCategoryRow(categoryDefinition, eles);

    var category = categoryDefinition.id;
    for (var key in this.prefs_.prefRecords_) {
      if (this.getPreferenceCategory(key) == category) {
        this.addInputRow(key, elem);
      }
    }
  }
};

/**
 * Add a series of HTML elements to allow inputting the value of the given
 * preference option.
 *
 * @param {!Object} categoryDef The hterm preference category object.
 * @param {!Element} parent
 * @return {!Element}
 */
nassh.PreferencesEditor.prototype.addCategoryRow =
    function(categoryDef, parent) {
  var details = document.createElement('section');
  details.className = 'category-details';

  var summary = document.createElement('h3');
  summary.innerText = this.getCategoryDescription(categoryDef);

  details.appendChild(summary);
  parent.appendChild(details);

  return details;
};

/**
 * Add a series of HTML elements to allow inputting the value of the given
 * preference option.
 *
 * @param {string} key
 * @param {!Element} parent
 */
nassh.PreferencesEditor.prototype.addInputRow = function(key, parent) {
  var input = this.createInput(key);

  // We want this element structure when we're done:
  // <div class='text'>
  //  <label>
  //    <span class='setting-label'>this-preference-setting-name</span>
  //    <span class='setting-ui'>
  //      <input ...>
  //    </span>
  //  </label>
  // </div>
  var div = document.createElement('div');
  var label = document.createElement('label');
  var span_text = document.createElement('span');
  var span_input = document.createElement('span');

  label.title = this.getPreferenceDescription(key);
  label.setAttribute('tabindex', '0');
  label.className = 'hflex';
  div.className = 'setting-container ' + input.type;
  span_text.className = 'setting-label';
  span_text.innerText = this.getPreferenceName(key);
  span_input.className = 'setting-ui';

  div.appendChild(label);
  span_input.appendChild(input);
  label.appendChild(span_text);
  label.appendChild(span_input);
  parent.appendChild(div);

  if (input.type == 'color') {
    var alabel = document.createElement('label');
    alabel.innerText = 'Alpha';
    alabel.className = 'alpha-text';
    alabel.setAttribute('tabindex', '0');
    span_input.appendChild(alabel);

    // Since the HTML5 color picker does not support alpha,
    // we have to create a dedicated slider for it.
    var ainput = document.createElement('input');
    ainput.type = 'range';
    ainput.id = key + ':alpha';
    ainput.min = '0';
    ainput.max = '100';
    ainput.name = 'settings';
    ainput.onchange = input.onchange;
    ainput.oninput = input.oninput;
    span_input.appendChild(ainput);
  }

  this.sync(input);
};

/**
 * @param {string} key
 * @return {!Element}
 */
nassh.PreferencesEditor.prototype.createInput = function(key) {
  var prefsEditor = this;

  var onchangeCursorReset = function() {
      nassh.PreferencesEditor.debounce(this, function(input) {
          // Chrome has a bug where it resets cursor position on us when
          // we debounce the input.  So manually save & restore cursor.
          var i = input.selectionStart;
          prefsEditor.onInputChange(input);
          if (document.activeElement === input)
            input.setSelectionRange(i, i);
        });
    };
  var onchange = function() {
      nassh.PreferencesEditor.debounce(this, function(input) {
          prefsEditor.onInputChange(input);
        });
    };
  var oninput = null;

  var addOption = function(parent, value) {
    var option = document.createElement('option');
    option.value = JSON.stringify(value);
    option.innerText = (value === null ? "auto" : value);
    parent.appendChild(option);
  };

  var input = document.createElement('input');
  switch(this.getPreferenceType(key)) {
    case 'bool':
      input.type = 'checkbox';
      break;

    case 'int':
      input.type = 'number';
      break;

    case 'enum':
      input = document.createElement('select');
      var prefValues = this.getPreferenceEnumValues(key);
      for(var i = 0; i < prefValues.length; i++) {
        addOption(input, prefValues[i]);
      }
      oninput = onchange;
      onchange = null;
      break;

    case 'tristate':
      input = document.createElement('select');
      [null, true, false].forEach(function(value) {
        addOption(input, value);
      });
      oninput = onchange;
      onchange = null;
      break;

    case 'string':
      input.type = 'text';
      input.size = 50;
      // Save simple strings immediately.
      oninput = onchangeCursorReset;
      onchange = null;
      break;

    case 'multiline-string':
      input = document.createElement('textarea');
      // Save simple strings immediately.
      oninput = onchangeCursorReset;
      onchange = null;
      break;

    case 'color':
      input.type = 'color';
      break;

    case 'url':
      input.type = 'url';
      input.size = 50;
      input.placeholder = 'https://example.com/some/file';
      break;

    case 'value':
    default:
      // We'll use JSON to go between object/user text.
      input = document.createElement('textarea');
      input.data = 'JSON';
      onchange = onchangeCursorReset;
      break;
  }

  input.name = 'settings';
  input.id = key;
  input.onchange = onchange;
  input.oninput = oninput;

  return input;
};

/**
 * @param {string} key
 * @return {string}
 */
nassh.PreferencesEditor.prototype.getPreferenceDescription = function(key) {
  var entry = hterm.PreferenceManager.defaultPreferences[key];
  if (entry === undefined)
    return '';

  const id = 'PREF_' + key.replace(/-/g, '_').toUpperCase();
  return hterm.msg(id, [], entry['help']);
};

/**
 * Get the translated hterm preference name.
 *
 * @param {string} key The hterm preference category object.
 * @return {string} The translated category text.
 */
nassh.PreferencesEditor.prototype.getPreferenceName = function(key) {
  const entry = hterm.PreferenceManager.defaultPreferences[key];
  if (entry === undefined) {
    return '';
  }

  const id = 'NAME_PREF_' + key.replace(/-/g, '_').toUpperCase();
  return hterm.msg(id, [], entry['name'] || key);
};

/**
 * Get the translated hterm category.
 *
 * @param {!Object} def The hterm preference category object.
 * @return {string} The translated category text.
 */
nassh.PreferencesEditor.prototype.getCategoryDescription = function(def) {
  const id = `TITLE_PREF_${def.id.toUpperCase()}`;
  return hterm.msg(id, [], def.text);
};

/**
 * @param {string} key
 * @return {string}
 */
nassh.PreferencesEditor.prototype.getPreferenceType = function(key) {
  var entry = hterm.PreferenceManager.defaultPreferences[key];
  if (entry) {
    const prefType = entry['type'];
    if (Array.isArray(prefType))
      return 'enum';
    return prefType;
  }

  switch(typeof this.prefs_.get(key)) {
    case 'boolean': return 'bool';
    case 'string': return 'string';
    case 'object': return 'value';
    case 'number': return 'int';
    default: return 'value';
  }
};

/**
 * @param {string} key
 * @return {!Array<string>}
 */
nassh.PreferencesEditor.prototype.getPreferenceEnumValues = function(key) {
  var entry = hterm.PreferenceManager.defaultPreferences[key];
  if (entry) {
    const prefType = entry['type'];
    if (Array.isArray(prefType))
      return prefType;
  }

  console.warn('Pref. is not an enum', key);
  return [];
};

/**
 * @param {string} key
 * @return {string}
 */
nassh.PreferencesEditor.prototype.getPreferenceCategory = function(key) {
  var entry = hterm.PreferenceManager.defaultPreferences[key];
  if (entry)
    return entry['category'];

  return hterm.PreferenceManager.Categories.Miscellaneous;
};

/**
 * Reset all preferences to their default state and update the HTML objects.
 */
nassh.PreferencesEditor.prototype.resetAll = function() {
  var settings = document.getElementsByName('settings');

  this.prefs_.resetAll();
  for (var i = 0; i < settings.length; ++i)
    this.sync(settings[i]);
  this.notify(nassh.msg('PREFERENCES_RESET'));
};

/**
 * Reset specified preference to its default state.
 *
 * @param {!Element} input An HTML input element to reset.
 */
nassh.PreferencesEditor.prototype.reset = function(input) {
  var keys = input.id.split(':');
  var key = keys[0];
  this.prefs_.reset(key);
  this.sync(input);
};

/**
 * Display a message to the user.
 *
 * @param {string} msg The string to show to the user.
 * @param {number=} timeout Optional how long to show the message.
 */
nassh.PreferencesEditor.prototype.notify = function(msg, timeout = 1000) {
  // Update status to let user know options were updated.
  clearTimeout(this.notifyTimeout_);
  var status = document.getElementById('label_status');
  status.innerText = msg;
  this.notifyTimeout_ = setTimeout(function() {
      status.innerHTML = '&nbsp;';
    }, timeout);
};
