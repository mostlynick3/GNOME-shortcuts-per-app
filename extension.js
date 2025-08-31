import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CONFIG_PATH = `${GLib.get_user_config_dir()}/shortcuts-per-app.json`;
const SYSTEM_SHORTCUTS_CACHE_PATH = `${GLib.get_user_config_dir()}/shortcuts-per-app-system-cache.json`;
const STATE_PATH = `${GLib.get_user_config_dir()}/shortcuts-per-app-state.json`;

const SettingsDialog = GObject.registerClass(
    class SettingsDialog extends ModalDialog.ModalDialog {
        _init(extension) {
            super._init({ styleClass: 'settings-dialog' });

            this._extension = extension;
            this._currentInputs = {};
            this._editingShortcut = null;
            this._keyPressSignal = null;
            this._setupUI();
            this._createMainMenu();
            this._setupKeyHandlers();
        }

        _loadShortcuts() {
            return this._extension._indicator._loadShortcuts();
        }

        _saveShortcuts(shortcuts) {
            this._extension._indicator._saveShortcuts(shortcuts);
        }

        _setupUI() {
            let content = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 20px; padding: 20px; min-width: 700px; min-height: 500px;',
            });

            this.contentLayout.add_child(content);

            this._titleLabel = new St.Label({
                text: 'Custom Shortcuts Per App',
                style: 'font-size: 18px; font-weight: bold; margin-bottom: 10px;',
            });
            content.add_child(this._titleLabel);

            this._descriptionLabel = new St.Label({
                text: 'Dynamically remap GNOME custom shortcuts based on the focused application.',
                style: 'color: #888; margin-bottom: 20px;',
            });
            content.add_child(this._descriptionLabel);

            this._scrollView = new St.ScrollView({
                style: 'max-height: 350px; border: 1px solid #444; border-radius: 6px;',
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                overlay_scrollbars: false,
            });

            this._contentBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 10px; padding: 10px;',
            });

            this._scrollView.add_child(this._contentBox);
            content.add_child(this._scrollView);

            this._buttonBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 10px; margin-top: 20px;',
            });
            content.add_child(this._buttonBox);
        }

        _clearContent() {
            this._contentBox.remove_all_children();
            this._buttonBox.remove_all_children();
            this._currentInputs = {};
            this._editingShortcut = null;
        }

        _createMainMenu() {
            this._clearContent();
            this._titleLabel.text = 'Custom Shortcuts Per App';
            this._descriptionLabel.show();

            let buttonContainer = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 10px;',
            });

            let viewBtn = new St.Button({
                label: 'View App Shortcuts',
                style_class: 'button',
                style: 'padding: 12px 24px;',
                can_focus: true,
                reactive: true,
            });
            viewBtn.connect('clicked', () => this._showExistingShortcuts());
            buttonContainer.add_child(viewBtn);

            let addBtn = new St.Button({
                label: 'New App Shortcut',
                style_class: 'button',
                style: 'padding: 12px 24px;',
                can_focus: true,
                reactive: true,
            });
            addBtn.connect('clicked', () => this._showAddShortcut());
            buttonContainer.add_child(addBtn);

            let activeWindowBtn = new St.Button({
                label: 'Check Active Window',
                style_class: 'button',
                style: 'padding: 12px 24px;',
                can_focus: true,
                reactive: true,
            });
            activeWindowBtn.connect('clicked', () => this._showActiveWindow());
            buttonContainer.add_child(activeWindowBtn);

            this._contentBox.add_child(buttonContainer);

            let closeBtn = new St.Button({
                label: 'Close',
                style_class: 'button',
                style: 'padding: 12px; width: 100%;',
                can_focus: true,
                reactive: true,
                x_expand: true,
            });
            closeBtn.connect('clicked', () => this.close());
            this._buttonBox.add_child(closeBtn);
        }

        _showActiveWindow() {
            this._clearContent();
            this._titleLabel.text = 'Active Window';
            this._descriptionLabel.hide();

            let win = global.display.focus_window;
            let windowName = win ? win.get_wm_class() || 'No window' : 'No window';

            let windowFrame = new St.Bin({
                style: 'border: 1px solid #444; border-radius: 8px; padding: 15px; margin-bottom: 20px; background: rgba(255,255,255,0.05);',
            });

            let windowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 10px;',
            });

            let windowLabel = new St.Label({
                text: `Window Class: ${windowName}`,
                style: 'font-family: monospace; font-size: 14px;',
            });
            windowBox.add_child(windowLabel);

            let selectableLabel = new St.Label({
                text: windowName,
                style: 'font-family: monospace; background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px; border: 1px solid #666;',
            });
            windowBox.add_child(selectableLabel);

            windowFrame.set_child(windowBox);
            this._contentBox.add_child(windowFrame);

            let copyBtn = new St.Button({
                label: 'Copy to Clipboard',
                style_class: 'button',
                style: 'padding: 12px; width: 100%; background: rgba(0,255,0,0.2);',
                                        can_focus: true,
                                        reactive: true,
                                        x_expand: true,
            });
            copyBtn.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, windowName);
                copyBtn.label = 'Copied!';

                let timeoutId = this._extension._indicator._addTimeoutSource(
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                        if (copyBtn && !copyBtn.is_finalized()) {
                            copyBtn.label = 'Copy to Clipboard';
                        }
                        return GLib.SOURCE_REMOVE;
                    })
                );
            });
            this._buttonBox.add_child(copyBtn);

            let backBtn = new St.Button({
                label: 'Back',
                style_class: 'button',
                style: 'padding: 12px; width: 100%;',
                can_focus: true,
                reactive: true,
                x_expand: true,
            });
            backBtn.connect('clicked', () => this._createMainMenu());
            this._buttonBox.add_child(backBtn);
        }

        _showExistingShortcuts() {
            this._clearContent();
            this._titleLabel.text = 'App Shortcuts';
            this._descriptionLabel.hide();

            let shortcuts = this._extension._indicator._loadShortcuts();
            let hasShortcuts = false;

            let headerRow = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style: 'spacing: 15px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 4px; margin-bottom: 10px;',
            });

            let nameHeader = new St.Label({
                text: 'Name',
                style: 'font-weight: bold; min-width: 140px;',
            });
            let appHeader = new St.Label({
                text: 'App',
                style: 'font-weight: bold; min-width: 120px;',
            });
            let shortcutHeader = new St.Label({
                text: 'Shortcut',
                style: 'font-weight: bold; min-width: 120px;',
            });
            let mappedHeader = new St.Label({
                text: 'Mapped to',
                style: 'font-weight: bold; min-width: 180px;',
            });
            let actionHeader = new St.Label({
                text: 'Actions',
                style: 'font-weight: bold; min-width: 120px;',
            });

            headerRow.add_child(nameHeader);
            headerRow.add_child(appHeader);
            headerRow.add_child(shortcutHeader);
            headerRow.add_child(mappedHeader);
            headerRow.add_child(actionHeader);

            this._contentBox.add_child(headerRow);

            let listContainer = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 5px;',
            });

            for (let app in shortcuts) {
                for (let key in shortcuts[app]) {
                    hasShortcuts = true;
                    let shortcutData = shortcuts[app][key];
                    let name = typeof shortcutData === 'object' ? shortcutData.name : `${app} - ${key}`;
                    let command = typeof shortcutData === 'object' ? shortcutData.command : shortcutData;

                    let row = new St.BoxLayout({
                        orientation: Clutter.Orientation.HORIZONTAL,
                        style: 'spacing: 15px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;',
                    });

                    let nameLabel = new St.Label({
                        text: this._truncateText(name, 18),
                                                 style: 'min-width: 140px; font-size: 12px;',
                    });
                    let appLabel = new St.Label({
                        text: this._truncateText(app, 15),
                                                style: 'min-width: 120px; font-family: monospace; color: #888; font-size: 12px;',
                    });
                    let keyLabel = new St.Label({
                        text: this._truncateText(key, 15),
                                                style: 'min-width: 120px; font-family: monospace; font-size: 12px;',
                    });
                    let commandLabel = new St.Label({
                        text: this._truncateText(command, 22),
                                                    style: 'min-width: 180px; color: #888; font-size: 12px;',
                    });

                    let actionBox = new St.BoxLayout({
                        orientation: Clutter.Orientation.HORIZONTAL,
                        style: 'spacing: 5px; min-width: 120px;',
                    });

                    let editBtn = new St.Button({
                        label: 'Edit',
                        style_class: 'button',
                        style: 'padding: 4px 8px; background: rgba(0,100,255,0.2); font-size: 11px;',
                                                can_focus: true,
                                                reactive: true,
                    });
                    editBtn.connect('clicked', () => this._editShortcut(app, key, shortcutData));

                    let deleteBtn = new St.Button({
                        label: 'Delete',
                        style_class: 'button',
                        style: 'padding: 4px 8px; background: rgba(255,0,0,0.2); font-size: 11px;',
                                                  can_focus: true,
                                                  reactive: true,
                    });
                    deleteBtn.connect('clicked', () => this._deleteShortcut(app, key));

                    actionBox.add_child(editBtn);
                    actionBox.add_child(deleteBtn);

                    row.add_child(nameLabel);
                    row.add_child(appLabel);
                    row.add_child(keyLabel);
                    row.add_child(commandLabel);
                    row.add_child(actionBox);

                    listContainer.add_child(row);
                }
            }

            if (!hasShortcuts) {
                let emptyLabel = new St.Label({
                    text: 'No shortcuts configured',
                    style: 'color: #888; text-align: center; padding: 20px;',
                });
                listContainer.add_child(emptyLabel);
            }

            this._contentBox.add_child(listContainer);

            let backBtn = new St.Button({
                label: 'Back',
                style_class: 'button',
                style: 'padding: 12px; width: 100%;',
                can_focus: true,
                reactive: true,
                x_expand: true,
            });
            backBtn.connect('clicked', () => this._createMainMenu());
            this._buttonBox.add_child(backBtn);
        }

        _showAddShortcut() {
            this._clearContent();
            this._titleLabel.text = 'Add App Shortcut';
            this._descriptionLabel.hide();

            this._showShortcutForm();
        }

        _editShortcut(app, key, shortcutData) {
            this._clearContent();
            this._titleLabel.text = 'Edit App Shortcut';
            this._descriptionLabel.hide();

            let name = typeof shortcutData === 'object' ? shortcutData.name : '';
            let command = typeof shortcutData === 'object' ? shortcutData.command : shortcutData;

            this._editingShortcut = { app, key, command, name };
            this._showShortcutForm(app, key, command, name);
        }

        _showShortcutForm(app = '', key = '', command = '', name = '') {
            let formContainer = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 15px;',
            });

            let nameGroup = this._createInputGroup('Shortcut Name', 'My Custom Shortcut', 'name', name);
            formContainer.add_child(nameGroup);

            let appGroup = this._createInputGroup('Application Class', 'firefox, code, org.mozilla.firefox', 'app', app);
            formContainer.add_child(appGroup);

            let keyGroup = this._createInputGroup('Keyboard Shortcut', '<Control>f, F3, <Alt>Tab', 'key', key);
            formContainer.add_child(keyGroup);

            let commandGroup = this._createInputGroup('Command', 'echo "Hello World"', 'command', command);
            formContainer.add_child(commandGroup);

            this._contentBox.add_child(formContainer);

            let helpLabel = new St.Label({
                text: 'Examples:\n• Name: My Custom Shortcut\n• App: firefox, code, org.mozilla.firefox\n• Shortcut: <Control>f, F3, <Alt>Tab\n• Command: echo "Hello World"',
                style: 'color: #888; font-size: 11px; margin-top: 10px; line-height: 1.4;',
            });
            this._contentBox.add_child(helpLabel);

            let saveBtn = new St.Button({
                label: this._editingShortcut ? 'Save Changes' : 'Save',
                style_class: 'button',
                style: 'padding: 12px; width: 100%; background: rgba(0,255,0,0.2);',
                                        can_focus: true,
                                        reactive: true,
                                        x_expand: true,
            });
            saveBtn.connect('clicked', () => {
                if (this._saveShortcut()) {
                    this._createMainMenu();
                }
            });
            this._buttonBox.add_child(saveBtn);

            let cancelBtn = new St.Button({
                label: 'Cancel',
                style_class: 'button',
                style: 'padding: 12px; width: 100%;',
                can_focus: true,
                reactive: true,
                x_expand: true,
            });
            cancelBtn.connect('clicked', () => {
                this._buttonBox.remove_child(saveBtn);
                this._buttonBox.remove_child(cancelBtn);
                this._createMainMenu();
            });
            this._buttonBox.add_child(cancelBtn);
        }

        _createInputGroup(title, placeholder, inputId, initialValue = '') {
            let group = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 5px;',
            });

            let label = new St.Label({
                text: title,
                style: 'font-weight: bold; font-size: 13px;',
            });
            group.add_child(label);

            let entry = new St.Entry({
                style: 'padding: 8px; border: 1px solid #666; border-radius: 4px; background: rgba(255,255,255,0.1);',
                                     hint_text: placeholder,
                                     text: initialValue,
                                     can_focus: true,
            });

            this._currentInputs[inputId] = entry;
            group.add_child(entry);

            return group;
        }

        _saveShortcut() {
            let name = this._currentInputs.name.get_text().trim();
            let app = this._currentInputs.app.get_text().trim().toLowerCase();
            let key = this._currentInputs.key.get_text().trim();
            let command = this._currentInputs.command.get_text().trim();

            if (!name || !app || !key || !command) {
                this._showError('All fields are required');
                return false;
            }

            let shortcuts = this._extension._indicator._loadShortcuts();

            if (this._editingShortcut) {
                if (shortcuts[this._editingShortcut.app] && shortcuts[this._editingShortcut.app][this._editingShortcut.key]) {
                    delete shortcuts[this._editingShortcut.app][this._editingShortcut.key];
                    if (Object.keys(shortcuts[this._editingShortcut.app]).length === 0) {
                        delete shortcuts[this._editingShortcut.app];
                    }
                }
            }

            if (!shortcuts[app]) shortcuts[app] = {};
            shortcuts[app][key] = {
                name: name,
                command: command
            };

            this._extension._indicator._saveShortcuts(shortcuts);

            Main.notify('App Shortcuts', `Shortcut "${name}" saved successfully!`);

            return true;
        }

        _deleteShortcut(app, key) {
            let dialog = new ModalDialog.ModalDialog({
                styleClass: 'confirm-dialog'
            });

            let content = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style: 'spacing: 20px; padding: 20px;',
            });

            let message = new St.Label({
                text: `Are you sure you want\nto delete the shortcut for\n${app}?`,
                style: 'font-size: 14px; text-align: center;',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            content.add_child(message);

            dialog.contentLayout.add_child(content);

            dialog.setButtons([
                {
                    label: 'Cancel',
                    action: () => dialog.close(),
                              key: Clutter.KEY_Escape,
                },
                {
                    label: 'Delete',
                    action: () => {
                        let shortcuts = this._extension._indicator._loadShortcuts();
                        if (shortcuts[app] && shortcuts[app][key]) {
                            delete shortcuts[app][key];
                            if (Object.keys(shortcuts[app]).length === 0) {
                                delete shortcuts[app];
                            }
                            this._extension._indicator._saveShortcuts(shortcuts);
                            this._showExistingShortcuts();
                        }
                        dialog.close();
                    },
                }
            ]);

            dialog.open();
        }

        _showError(message) {
            Main.notify('Shortcuts Per App', message);
        }

        _truncateText(text, maxLength) {
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength - 3) + '...';
        }

        _setupKeyHandlers() {
            this._keyPressSignal = this.connect('key-press-event', (actor, event) => {
                let symbol = event.get_key_symbol();
                if (symbol === Clutter.KEY_Escape) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _disconnectSignals() {
            if (this._keyPressSignal) {
                this.disconnect(this._keyPressSignal);
                this._keyPressSignal = null;
            }
        }

        destroy() {
            this._disconnectSignals();
            this._currentInputs = {};
            this._editingShortcut = null;
            this._extension = null;

            super.destroy();
        }
    });

const AppShortcutsToggle = GObject.registerClass(
    class AppShortcutsToggle extends QuickSettings.QuickMenuToggle {
        _init(indicator) {
            super._init({
                title: 'App Shortcuts',
                iconName: 'preferences-desktop-keyboard-shortcuts-symbolic',
                toggleMode: true
            });

            this._indicator = indicator;
            this._clickedSignal = null;
            this._indicatorEnabledSignal = null;
            this._enableItemSignal = null;

            this.menu.setHeader('preferences-desktop-keyboard-shortcuts-symbolic',
                                'App Shortcuts', null);

            this._enableItem = new PopupMenu.PopupSwitchMenuItem(_('Enabled'), this._indicator.enabled);
            this._enableItemSignal = this._enableItem.connect('toggled', (item, state) => {
                this._indicator.enabled = state;
            });
            this.menu.addMenuItem(this._enableItem);

            const settingsItem = this.menu.addAction(_('Settings'), () => {
                this._indicator._showSettingsDialog();
            });

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            settingsItem.visible = Main.sessionMode.allowSettings;

            this._clickedSignal = this.connect('clicked', () => {
                this._indicator.toggle();
                this._enableItem.setToggleState(this._indicator.enabled);
            });

            this._indicatorEnabledSignal = this._indicator.connect('notify::enabled', () => {
                this.checked = this._indicator.enabled;
                this._enableItem.setToggleState(this._indicator.enabled);
            });

            this.checked = this._indicator.enabled;
        }

        _disconnectSignals() {
            if (this._enableItemSignal) {
                this._enableItem.disconnect(this._enableItemSignal);
                this._enableItemSignal = null;
            }

            if (this._clickedSignal) {
                this.disconnect(this._clickedSignal);
                this._clickedSignal = null;
            }

            if (this._indicatorEnabledSignal) {
                this._indicator.disconnect(this._indicatorEnabledSignal);
                this._indicatorEnabledSignal = null;
            }
        }

        destroy() {
            this._disconnectSignals();
            this._enableItem = null;
            this._indicator = null;

            super.destroy();
        }
    });

const AppShortcutsIndicator = GObject.registerClass({
    Properties: {
        'enabled': GObject.ParamSpec.boolean(
            'enabled', 'enabled', 'enabled',
            GObject.ParamFlags.READWRITE,
            true
        ),
    },
}, class AppShortcutsIndicator extends QuickSettings.SystemIndicator {
    _init(extension) {
        super._init();

        this._extension = extension;
        this._enabled = this._loadState();
        this.quickSettingsItems = [];
        this._toggle = new AppShortcutsToggle(this);
        this.quickSettingsItems.push(this._toggle);
        this._shortcuts = this._loadShortcuts();
        this._customSettings = new Gio.Settings({ schema: 'org.gnome.settings-daemon.plugins.media-keys' });
        this._cachedShortcuts = new Map();
        this._persistentSystemShortcuts = new Map();
        this._currentApp = null;
        this._settingsDialog = null;
        this._lastSystemShortcutsHash = null;
        this._focusSignal = null;
        this._allTimeoutIds = new Set();

        this._loadPersistentSystemShortcuts();
        this._connectSignals();
        this._cacheStandardShortcuts();
        this._savePersistentSystemShortcuts();

        this._toggle.checked = this._enabled;
        this._toggle._enableItem.setToggleState(this._enabled);
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        if (this._enabled === value)
            return;

        this._enabled = value;
        this.notify('enabled');

        this._saveState();

        if (!this._enabled) {
            this._restoreCachedShortcuts();
        } else {
            this._onWindowFocusChanged();
        }
    }

    toggle() {
        this.enabled = !this.enabled;
    }

    _loadState() {
        try {
            let file = Gio.File.new_for_path(STATE_PATH);
            if (!file.query_exists(null)) {
                return true;
            }

            let [success, contents] = file.load_contents(null);
            if (success) {
                let data = JSON.parse(new TextDecoder().decode(contents));
                return data.enabled !== false;
            }
        } catch (e) {
            console.warn('Failed to load extension state:', e);
        }

        return true;
    }

    _saveState() {
        try {
            let file = Gio.File.new_for_path(STATE_PATH);
            let dir = file.get_parent();
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            let data = {
                enabled: this._enabled,
                timestamp: Date.now(),
                                                    version: 1
            };

            file.replace_contents(
                new TextEncoder().encode(JSON.stringify(data, null, 2)),
                                  null, false, Gio.FileCreateFlags.NONE, null
            );
        } catch (e) {
            console.error('Failed to save extension state:', e);
        }
    }

    _connectSignals() {
        this._focusSignal = global.display.connect('notify::focus-window', () => {
            if (this._enabled) {
                this._refreshSystemShortcutsCache();
                this._onWindowFocusChanged();
            }
        });
    }

    _disconnectSignals() {
        if (this._focusSignal) {
            global.display.disconnect(this._focusSignal);
            this._focusSignal = null;
        }
    }

    _addTimeoutSource(sourceId) {
        if (sourceId) {
            this._allTimeoutIds.add(sourceId);
        }
        return sourceId;
    }

    _removeTimeoutSource(sourceId) {
        if (sourceId && this._allTimeoutIds.has(sourceId)) {
            GLib.source_remove(sourceId);
            this._allTimeoutIds.delete(sourceId);
        }
    }

    _removeAllTimeoutSources() {
        for (let sourceId of this._allTimeoutIds) {
            GLib.source_remove(sourceId);
        }
        this._allTimeoutIds.clear();
    }

    _onWindowFocusChanged() {
        if (!this._enabled) return;

        let win = global.display.focus_window;
        let newApp = win ? win.get_wm_class()?.toLowerCase() : null;

        if (newApp !== this._currentApp) {
            this._restoreCachedShortcuts();

            if (newApp && this._shortcuts[newApp]) {
                this._registerAppShortcuts(newApp);
            }

            this._currentApp = newApp;
        }
    }

    _refreshSystemShortcutsCache() {
        let currentSystemShortcuts = this._getCurrentSystemShortcuts();
        let currentHash = this._generateShortcutsHash(currentSystemShortcuts);

        if (this._lastSystemShortcutsHash !== currentHash) {
            this._cachedShortcuts.clear();
            this._persistentSystemShortcuts.clear();
            this._cacheStandardShortcuts();
            this._savePersistentSystemShortcuts();
            this._lastSystemShortcutsHash = currentHash;
        }
    }

    _getCurrentSystemShortcuts() {
        let shortcuts = new Map();
        let customKeys = this._customSettings.get_strv('custom-keybindings');

        for (let keyPath of customKeys) {
            if (keyPath.includes('spa-')) continue;

            try {
                let keySettings = new Gio.Settings({
                    schema: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
                    path: keyPath
                });

                let name = keySettings.get_string('name');
                let binding = keySettings.get_string('binding');
                let command = keySettings.get_string('command');

                if (name && binding && command) {
                    shortcuts.set(keyPath, { name, binding, command });
                }
            } catch (e) {
                console.warn(`Failed to read shortcut at ${keyPath}:`, e);
            }
        }

        return shortcuts;
    }

    _generateShortcutsHash(shortcuts) {
        let hashString = '';
        let sortedEntries = Array.from(shortcuts.entries()).sort();

        for (let [path, shortcut] of sortedEntries) {
            hashString += `${path}:${shortcut.name}:${shortcut.binding}:${shortcut.command};`;
        }

        let hash = 0;
        for (let i = 0; i < hashString.length; i++) {
            const char = hashString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        return hash.toString();
    }

    _cacheStandardShortcuts() {
        let customKeys = this._customSettings.get_strv('custom-keybindings');

        for (let keyPath of customKeys) {
            if (keyPath.includes('spa-')) continue;

            try {
                let keySettings = new Gio.Settings({
                    schema: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
                    path: keyPath
                });

                let name = keySettings.get_string('name');
                let binding = keySettings.get_string('binding');
                let command = keySettings.get_string('command');

                if (name && binding && command) {
                    this._cachedShortcuts.set(keyPath, { name, binding, command });
                    this._persistentSystemShortcuts.set(keyPath, { name, binding, command });
                }
            } catch (e) {
                console.warn(`Failed to cache shortcut at ${keyPath}:`, e);
            }
        }

        this._lastSystemShortcutsHash = this._generateShortcutsHash(this._persistentSystemShortcuts);
    }

    _registerAppShortcuts(app) {
        let appShortcuts = this._shortcuts[app];
        let customKeys = [...this._customSettings.get_strv('custom-keybindings')];

        for (let [key, shortcutData] of Object.entries(appShortcuts)) {
            let command = typeof shortcutData === 'object' ? shortcutData.command : shortcutData;
            let name = typeof shortcutData === 'object' ? shortcutData.name : `${app} ${key}`;

            let keyPath = `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/spa-${app}-${Date.now()}/`;

            try {
                let keySettings = new Gio.Settings({
                    schema: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
                    path: keyPath
                });

                keySettings.set_string('name', `SPA: ${name}`);
                keySettings.set_string('binding', key);
                keySettings.set_string('command', command);

                customKeys.push(keyPath);
            } catch (e) {
                console.error(`Failed to register shortcut for ${app}:`, e);
            }
        }

        this._customSettings.set_strv('custom-keybindings', customKeys);
    }

    _restoreCachedShortcuts() {
        let customKeys = this._customSettings.get_strv('custom-keybindings');
        let filteredKeys = customKeys.filter(path => !path.includes('spa-'));

        let shortcutsToRestore = new Map([...this._cachedShortcuts, ...this._persistentSystemShortcuts]);

        for (let [keyPath, shortcut] of shortcutsToRestore.entries()) {
            if (!filteredKeys.includes(keyPath)) {
                filteredKeys.push(keyPath);
            }

            try {
                let keySettings = new Gio.Settings({
                    schema: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
                    path: keyPath
                });

                keySettings.set_string('name', shortcut.name);
                keySettings.set_string('binding', shortcut.binding);
                keySettings.set_string('command', shortcut.command);
            } catch (e) {
                console.warn(`Failed to restore shortcut at ${keyPath}:`, e);
            }
        }

        this._customSettings.set_strv('custom-keybindings', filteredKeys);
    }

    _loadPersistentSystemShortcuts() {
        try {
            let file = Gio.File.new_for_path(SYSTEM_SHORTCUTS_CACHE_PATH);
            if (!file.query_exists(null)) {
                return;
            }

            let [success, contents] = file.load_contents(null);
            if (success) {
                let data = JSON.parse(new TextDecoder().decode(contents));
                this._persistentSystemShortcuts = new Map(Object.entries(data.shortcuts || {}));
                this._lastSystemShortcutsHash = data.hash || null;
            }
        } catch (e) {
            console.warn('Failed to load persistent system shortcuts:', e);
            this._persistentSystemShortcuts = new Map();
        }
    }

    _savePersistentSystemShortcuts() {
        try {
            let file = Gio.File.new_for_path(SYSTEM_SHORTCUTS_CACHE_PATH);
            let dir = file.get_parent();
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            let data = {
                shortcuts: Object.fromEntries(this._persistentSystemShortcuts),
                                                    hash: this._lastSystemShortcutsHash,
                                                    timestamp: Date.now(),
                                                    version: 1
            };

            file.replace_contents(
                new TextEncoder().encode(JSON.stringify(data, null, 2)),
                                  null, false, Gio.FileCreateFlags.NONE, null
            );
        } catch (e) {
            console.error('Failed to save persistent system shortcuts:', e);
        }
    }

    _showSettingsDialog() {
        if (this._settingsDialog) {
            return;
        }

        this._settingsDialog = new SettingsDialog(this._extension);
        this._settingsDialog.connect('closed', () => {
            this._settingsDialog.destroy();
            this._settingsDialog = null;
        });
        this._settingsDialog.open();
    }

    _loadShortcuts() {
        try {
            let file = Gio.File.new_for_path(CONFIG_PATH);
            if (!file.query_exists(null)) return {};
            let [success, contents] = file.load_contents(null);
            if (success) {
                return JSON.parse(new TextDecoder().decode(contents));
            }
        } catch (e) {
            console.error('Failed to load shortcuts:', e);
        }
        return {};
    }

    _saveShortcuts(shortcuts) {
        this._shortcuts = shortcuts;

        try {
            let file = Gio.File.new_for_path(CONFIG_PATH);
            let dir = file.get_parent();
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            file.replace_contents(
                new TextEncoder().encode(JSON.stringify(this._shortcuts, null, 2)),
                                  null, false, Gio.FileCreateFlags.NONE, null
            );

        } catch (e) {
            console.error('Failed to save shortcuts:', e);
            throw e;
        }
    }

    destroy() {
        this._saveState();
        this._savePersistentSystemShortcuts();
        this._removeAllTimeoutSources();
        this._restoreCachedShortcuts();
        this._disconnectSignals();

        if (this._settingsDialog) {
            this._settingsDialog.close();
            this._settingsDialog.destroy();
            this._settingsDialog = null;
        }

        if (this._toggle) {
            this._toggle.destroy();
            this._toggle = null;
        }

        this.quickSettingsItems.forEach(item => {
            if (item && typeof item.destroy === 'function') {
                item.destroy();
            }
        });
        this.quickSettingsItems = [];

        this._cachedShortcuts.clear();
        this._persistentSystemShortcuts.clear();
        this._customSettings = null;
        this._extension = null;
        this._currentApp = null;

        super.destroy();
    }
});

export default class ShortcutsPerAppExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
    }

    enable() {
        this._indicator = new AppShortcutsIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => {
                if (item && typeof item.destroy === 'function') {
                    item.destroy();
                }
            });

            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
