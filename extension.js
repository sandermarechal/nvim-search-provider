/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/**
 * Nvim Search Provider for GNOME Shell, adapted from the Remmina Search
 * Provider for GNOME Shell by Alex Murray.
 *
 * Copyright (c) 2023 Sander Marechal <sander@marechal.io>
 * Copyright (c) 2020 Alex Murray <murray.alex@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as Search from 'resource:///org/gnome/shell/ui/search.js';

let provider = null;

log('nvim extension loaded');

var NvimSearchProvider = class NvimSearchProvider_SearchProvider {
    constructor(name) {
        this.id = 'nvim';
        this._projects = [];

        let path = GLib.build_filenamev([GLib.get_home_dir(), 'dev']);
        let dir = Gio.file_new_for_path(path);
        let monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        monitor.connect('changed', (monitor, file, other_file, type) => {
            this._onMonitorChanged(monitor, file, other_file, type);
        });
        /* save a reference so we can cancel it on disable */
        this._nvimMonitor = monitor;

        this._listDirAsync(dir, (files) => {
            files.map((f) => {
                let name = f.get_name();
                let file_path = GLib.build_filenamev([path, name]);
                let file = Gio.file_new_for_path(file_path);
                this._onMonitorChanged(this._nvimMonitor, file, null, Gio.FileMonitorEvent.CREATED);
            }, this);
        });
        log('nvim extension started');
    }

    _onMonitorChanged(monitor, file, other_file, type) {
        let path = file.get_path();
        let filetype = file.query_file_type(Gio.FileQueryInfoFlags.NONE, null);

        if (filetype != Gio.FileType.DIRECTORY) {
            return;
        }

        if (type == Gio.FileMonitorEvent.CREATED ||
            type == Gio.FileMonitorEvent.CHANGED ||
            type == Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
            let name = file.get_basename();
            if (name) {
                let project = {
                    name: name,
                    path: path
                };
                // if this project already exists in _projects then
                // delete and add again to update it
                for (let i = 0; i < this._projects.length; i++) {
                    let p = this._projects[i];
                    if (p.path == project.path) {
                        this._projects.splice(i, 1);
                        break;
                    }
                }
                this._projects.push(project);
            }
        } else if (type == Gio.FileMonitorEvent.DELETED) {
            for (let i = 0; i < this._projects.length; i++) {
                let p = this._projects[i];
                if (p.path == path) {
                    /* remove the current element from _projects */
                    this._projects.splice(i, 1);
                    break;
                }
            }
        }
    }

    // steal from FileUtils since doesn't exist in FileUtils anymore
    // since GNOME 3.12
    _listDirAsync(file, callback) {
        let allFiles = [];
        file.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW,
            null,
            function (obj, res) {
                let enumerator = obj.enumerate_children_finish(res);
                function onNextFileComplete(obj, res) {
                    let files = obj.next_files_finish(res);
                    if (files.length) {
                        allFiles = allFiles.concat(files);
                        enumerator.next_files_async(100, GLib.PRIORITY_LOW, null, onNextFileComplete);
                    } else {
                        enumerator.close(null);
                        callback(allFiles);
                    }
                }
                enumerator.next_files_async(100, GLib.PRIORITY_LOW, null, onNextFileComplete);
            });
    }

    _findProject(id) {
        let project = null;

        // find project details
        for (let j = 0; !project && j < this._projects.length; j++) {
            let _project = this._projects[j];
            if (_project.name == id) {
                project = _project;
            }
        }

        return project;
    }

    createResultObject(metaInfo, terms) {
        metaInfo.createIcon = (size) => {
            let box = new St.BoxLayout();
            let gicon = Gio.icon_new_for_string('/opt/nvim-linux-x86_64/share/icons/hicolor/128x128/apps/nvim.png');
            let scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            let icon = new St.Icon({ gicon: gicon, icon_size: size / scale_factor });

            box.add_child(icon);

            return box;
        };

        return new Search.GridSearchResult(provider, metaInfo, Main.overview.searchController._searchResults);
    }

    filterResults(results, max) {
        return results.slice(0, max);
    }

    _wrapText(str, maxWidth) {
        return str.replace(
            new RegExp(`(?![^\\n]{1,${maxWidth}}$)([^\\n]{1,${maxWidth}})\\s`, 'g'),
            '$1\n');
    }

    async getResultMetas(ids, cancellable) {
        let metas = [];

        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let project = this._findProject(id);

            if (project != null) {
                metas.push({
                    id: id,
                    name: this._wrapText(project.name, 15),
                    path: project.path
                });
            } else {
                log("failed to find project with id: " + id);
            }
        }

        return metas;
    }

    activateResult(id, terms) {
        let project = this._findProject(id);

        if (project != null) {
            Util.spawn(['/bin/bash', '-c', 'cd ' + project.path + ' && alacritty --class Neovim --title "Neovim ' + project.name + '" -e nvim']);
        } else {
            log("failed to find project with id: " + id);
        }

        // specifically hide the overview -
        // https://github.com/alexmurray/remmina-search-provider/issues/19
        Main.overview.hide();
    }

    _getResultSet(projects, terms, cancellable) {
        let results = [];
        // search for terms ignoring case - create re's once only for
        // each term and make sure matches all terms
        let res = terms.map(function (term) { return new RegExp(term, 'i'); });
        for (let i = 0; i < projects.length; i++) {
            let project = projects[i];
            let failed = false;
            for (let j = 0; !failed && j < res.length; j++) {
                let re = res[j];
                // search on name or the term nvim
                failed |= project.name.search(re) < 0;
            }
            if (!failed) {
                results.push(project.name);
            }
        }
        return results;
    }

    async getInitialResultSet(terms, cancellable) {
        let realResults = this._getResultSet(this._projects, terms, cancellable);
        return realResults;
    }

    async getSubsearchResultSet(results, terms, cancellable) {
        return this.getInitialResultSet(terms, cancellable);
    }
};

export default class NvimSearchProviderExtension {
    enable () {
        if (!provider) {
            provider = new NvimSearchProvider();
            Main.overview.searchController.addProvider(provider);
            log('nvim extension enabled');
        }
    }

    disable() {
        if (provider) {
            Main.overview.searchController.removeProvider(provider);
            provider._nvimMonitor.cancel();
            provider = null;
        }
    }
}
