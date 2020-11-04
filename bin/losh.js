#!/usr/bin/env node

const FS = require('fs');
const Path = require('path');
const ShellSpawn = require('child_process').spawn;
const ShellExec = require('child_process').exec;
const HTTPS = require('https');
const OS = require('os');
const Readline = require('readline');

let win = false;
if (OS.version().toLowerCase().startsWith('win') || OS.type().toLowerCase().startsWith('win') || OS.platform().toLowerCase().startsWith('win')) {
  win = true;
}

const SCRIPT_DIRECTORY = 'loom';
const VERSION = 'main';

class Log {

  static get codes() {
    if (this._codes === undefined) {
      this._codes = {
        color: {
          reset: [0, 0],
          red: [31, 39],
          green: [32, 39],
          yellow: [33, 39],
          blue: [94, 39],
          magenta: [35, 39],
          cyan: [36, 39],
          white: [37, 39],
        },
        bg: {
          red: [41, 49],
          green: [42, 49],
          yellow: [43, 49],
          blue: [44, 49],
          magenta: [45, 49],
          cyan: [46, 49],
        },
        logs: {
          '@': [36, 39],
          '!': [35, 39, '"'],
        },
      };
    }
    return this._codes;
  }

  constructor(codes) {
    this._codes = codes;
    for (const cat in codes) {
      for (const name in codes[cat]) {
        this[cat] = this[cat] || {};
        this[cat][name] = this.inColor.bind(this, codes[cat][name]);
      }
    }
  }

  insertStyle(full, insert) {
    const match = full.match(/\x1B\[(\d)+m/g);

    if (match && match[0]) {
      return insert + '\u001b[' + match[0];
    }
    return insert;
  }

  inColor(code, string) {
    return '\u001b[' + code[0] + 'm' + (code[2] || '') + string + (code[2] || '') + '\u001b[' + code[1] + 'm';
  }

  replace(message, playeholders = {}) {
    for (const index in playeholders) {
      if (this.logs[index[0]] === undefined) {
        message = message.replace(new RegExp('\\[' + index + '\\]', 'g'), playeholders[index]);
      } else {
        message = message.replace(new RegExp('\\[' + index + '\\]', 'g'), this.insertStyle(message, this.logs[index[0]](playeholders[index])));
      }
    }
    return message;
  }

  note(message, playeholders = {}) {
    console.log(this.replace(this.color.blue(message), playeholders));
  }

  warn(message, playeholders = {}) {
    message = '[WARN]: ' + message;
    console.warn(this.replace(this.color.yellow(message), playeholders));
  }

  error(message, playeholders = {}) {
    message = '[ERROR]: ' + message;
    console.error(this.replace(this.color.red(message), playeholders));
  }

  success(message, playeholders = {}) {
    message = '[SUCCESS]: ' + message;
    console.log(this.replace(this.bg.green(message), playeholders));
  }

  failed(message, playeholders = {}) {
    message = '[FAILED]: ' + message;
    console.error(this.replace(this.bg.red(message), playeholders));
  }

}

class ShellCommand {

  get command() { return null; }

  /**
   * @param {Executable} executable 
   */
  constructor(executable) {
    this._executable = executable;
  }

  getCommand() {
    if (win) {
      return this.command.replace(/\\/g, '/');
    } else {
      return this.command;
    }
  }

  sh(...args) {
    return this._executable.sh(args);
  }

  shell(...args) {
    return this._executable.shell(args);
  }

  execute(...args) {
    return this.shell(this.getCommand(), ...args);
  }

  shExecute(...args) {
    return this.sh(this.getCommand(), ...args);
  }

}

class Node extends ShellCommand {

  get command() {
    return 'node';
  }

  version() {
    return this.shExecute('-v').then(data => {
      const matches = data.out.match(/(\d+)\.(\d+)\.(\d+)/);

      return {
        full: matches[0],
        major: matches[1],
        minor: matches[2],
        patch: matches[3],
      };
    });
  }

}

class Git extends ShellCommand {

  get command() {
    return 'git';
  }

  /**
   * Channel for "git checkout <branch>".
   * 
   * @param {string} branch
   * @returns {Promise}
   */
  checkout(branch) {
    return this.shell(this.getCommand(), 'checkout', branch);
  }

  /**
   * Get the current commit hash. Channel for "git rev-parse HEAD".
   * 
   * @returns {Promise<String>}
   */
  getCurrentHash() {
    return this.shExecute('rev-parse', 'HEAD').then(data => data.out.trim());
  }

  /**
   * Get the current branch. Channel for "git branch --show-current".
   * 
   * @returns {Promise<String>}
   */
  getCurrentBranch() {
    return this.shExecute('branch', '--show-current').then(data => data.out.trim());
  }

}

class Drush extends ShellCommand {

  get command() {
    return this._executable.path('drupal', 'vendor/bin/drush');
  }

  /**
   * Channel for "drush cr"
   * 
   * @returns {Promise}
   */
  cr() {
    return this.execute('cr');
  }

  /**
   * Channel for "drush cim"
   * 
   * @param {Boolean} force "drush cim -y"
   */
  cim(force) {
    if (force) {
      return this.execute('cim', '-y');
    } else {
      return this.execute('cim');
    }
  }

  /**
   * Channel for "drush cex"
   * 
   * @param {Boolean} force "drush cex -y"
   */
  cex(force) {
    if (force) {
      return this.execute('cex', '-y');
    } else {
      return this.execute('cex');
    }
  }

  /**
   * Get the active database
   * 
   * @returns {Promise<String>}
   */
  getDB() {
    return this.shExecute('eval "echo \\Drupal::database()->getConnectionOptions()[\'database\'];"').then(data => data.out);
  }

  sqlCli(arg) {
    return this._executable.exec(['echo', arg, '|', '"' + this.getCommand() + '"', 'sql-cli'].join(' ')).then(data => console.log(data)).catch((e) => console.log(e));
  }

  sqlSelect(query) {
    return this._executable.shell(['echo', '"' + query + '"', '|', '"' + this.getCommand() + '"', 'sql-cli'], null, {}, false, false);
  }

}

class Composer extends ShellCommand {

  get command() {
    return 'composer';
  }

  /**
   * Channel for "composer install"
   * 
   * @returns {Promise}
   */
  install() {
    return this.execute('install');
  }

}

class Executable {

  /**
   * @param {System} system 
   * @param {string} name
   * @param {string} file 
   */
  constructor(system, name, file) {
    this.drush = new Drush(this);
    this.git = new Git(this);
    this.composer = new Composer(this);
    this.node = new Node(this);
    this.system = system;
    this.name = name;
    if (typeof file === 'string') {
      this.file = file;
      this._factory = undefined;
    } else {
      this.file = null;
      this._factory = file;
    }
  }

  /**
   * @returns {Log}
   */
  get log() {
    return this.system.log;
  }

  /**
   * @returns {NodeRequire}
   */
  get require() {
    return this.system.require;
  }

  /**
   * Returns the extname of the representing file. By native code it will return ".js".
   * 
   * @returns {String}
   */
  get extname() {
    if (this.file === null) return '.js';
    return Path.extname(this.file);
  }

  /**
   * Returns the function if exist.
   * 
   * @returns {Function}
   */
  get factory() { 
    if (this._factory === undefined) {
      if (this.extname === '.js') {
        this._factory = require(this.file);
      } else {
        this._factory = null;
      }
    }
    return this._factory;
  }

  /**
   * Returns the parameter of the command.
   * 
   * @returns {Object[]}
   */
  get params() {
    if (this._params === undefined) {
      this._params = [];
      const params = this.factory && this.factory.params || null;
      if (params === null) return this._params;

      for (const value of params) {
        if (!Array.isArray(value)) value = [value];
        const param = {
          required: false,
        };
        const [ name, description, options, fallback ] = value;

        if (name.startsWith('!')) {
          param.name = name.substring(1);
          param.required = true;
        } else {
          param.name = name;
        }
        param.description = description || null;
        param.options = options && (Array.isArray(options) ? options : [options]) || null;
        param.fallback = fallback || null;
        param.type = 'argument';

        param.usage = param.options ? param.options.join('|') : param.name;
        param.usage += param.fallback ? '=' + param.fallback : '';
        if (param.required) {
          param.usage = '<' + param.usage + '>';
        } else {
          param.usage = '[' + param.usage + ']';
        }
        this._params.push(param);
      }
    }

    return this._params;
  }

  /**
   * Returns the description of the command if exits.
   * 
   * @returns {String}
   */
  get description() {
    return this.factory && this.factory.description || null;
  }

  /**
   * Returns a string for command to show an usage example.
   * 
   * @returns {String}
   */
  get usage() {
    const output = ['lash', this.name];

    if (this.params.length) {
      for (const param of this.params) {
        output.push(param.usage);
      }
    }
    return output.join(' ');
  }

  /**
   * Create a path with a starting path. 
   * 
   * @param {string} cwd The base path [root, drupal, source]
   * @param  {...any} paths 
   * @returns {String}
   */
  path(cwd = 'drupal', ...paths) {
    return Path.join(this.system.paths[cwd], ...paths);
  }

  /**
   * Execute a command with the launcher.
   * 
   * @param {String[]} args 
   */
  execute(args) {
    return this.system.execute(args);
  }

  exec(command) {
    ShellExec(command, (...args) => {
      console.log(args);
    });
  }

  /**
   * Catch the output of a shell command.
   * 
   * @param {String[]} args 
   * @param {String} cwd 
   * @returns {Promise<Object>}
   */
  sh(args, cwd = null) {
    return new Promise((resolve, reject) => {
      const data = {
        out: '',
        err: '',
      };
      const options = {
        cwd: cwd || this.system.paths.drupal || process.cwd(),
        shell: true,
      };

      console.log(args.join(' '), options);
      const command = ShellSpawn(args.shift(), args, options);

      command.on('error', error => {
        this.system.log.error(error.message);
        reject({ error });
      });

      command.stdout.on('data', (chunk) => {
        data.out += chunk;
      });

      command.stderr.on('data', (chunk) => {
        data.err += chunk;
      });

      command.on('close', code => {
        data.code = code;
        if (code === 0) {
          resolve(data)
        } else {
          data.error = new Error('Exit with code: ' + code);
          reject(data);
        }
      });
    });
  }

  /**
   * Channel execution of shell command.
   * 
   * @param {String[]} args 
   * @param {String} cwd 
   * @returns {Promise<Object>}
   */
  shell(args, cwd = null) {
    return new Promise((resolve, reject) => {
      const options = {
        cwd: cwd || this.system.paths.drupal || process.cwd(),
        shell: true,
        stdio: 'inherit',
      };

      console.log(args.join(' '), options);
      const command = ShellSpawn(args.shift(), args, options);

      command.on('error', error => {
        this.system.log.error(error.message);
        reject({ error });
      });

      command.on('close', code => {
        if (code === 0) {
          resolve({ code })
        } else {
          reject({ code, error: new Error('Exit with code: ' + code) });
        }
      });
    });
  }

  /**
   * Execute the command.
   * 
   * @param {String[]} args 
   * @returns {Promise}
   */
  run(args) {
    this._args = args;
    this.args = {
      _: [],
    };
    if (this.params.length) {
      for (let i = 0; i < (args.length < this.params.length ? this.params.length : args.length); i++) {
        if (this.params[i]) {
          this.args[this.params[i].name] = args[i] || this.params[i].fallback;
          if (this.params[i].required && this.args[this.params[i].name] === null) {
            this.log.error('The argument [!argument] is required!', {'!argument': this.params[i].name});
            return Promise.reject();
          }
        } else {
          this.args._.push(args[i]);
        }
      }
    }
    return this.doRun().catch((error) => {
      this.log.error(error.message || error || 'Unknown error');
    });
  }

  /**
   * Execute the command.
   * 
   * @returns {Promise}
   */
  doRun() {
    switch (this.extname) {
      case '.js':
        return new Promise((resolve, reject) => {
          return this.factory.call(this, resolve, reject);
        });
      case '.sh':
        return this.shell(['sh', this.file, ...this._args]);
      default: 
        this.log.error('The extname [@extname] is unknown.', {'@extname': this.extname});
        return Promise.reject();
    }
  }

  /**
   * HTTPS request a file.
   * 
   * @param {String} url 
   * @returns {Promise<String>}
   */
  request(url) {
    return new Promise((resolve, reject) => {
      this.log.note('Request [' + url + '] ...');
      HTTPS.get(url, (response) => {
        if (response.statusCode !== 200) {
          return reject(response.statusCode + ' - ' + response.statusMessage + ' [' + url + ']');
        }
        let data = '';
        
        response.on('data', (chunk) => {
          this.log.note('Get content (' + chunk.length + ' b) ...');
          data += chunk;
        });
        response.on('end', () => {
          this.log.note('Received data (' + data.length + ' b) ...');
          resolve(data);
        });
      });
    })
    .catch((error) => {
      return error;
    });
  }

  replace(content, bag = {}) {
    for (const item in bag) {
      content = content.replace(new RegExp('\\{\\{' + item + '\\}\\}', 'g'), bag[item]);
    }
    for (const path in this.system.paths) {
      content = content.replace(new RegExp('@' + path, 'g'), this.system.paths[path]);
    }
    return content;
  }

  /**
   * HTTPS request a file and replace placeholders.
   * 
   * @param {String} template 
   * @param {Object<string, string>} placeholders 
   * @returns {Promise<String>}
   */
  template(template, placeholders = {}) {
    return this.request('https://raw.githubusercontent.com/loomgmbh/node-losh/' + VERSION + '/src/templates/' + template).then((content) => {
      this.log.note('Replace placeholders in template ...');
      return this.replace(content, placeholders);
    });
  }

  for(list, factory = null) {
    factory = factory || function(value) {return value();};
    let promise = null;
    for (const index in list) {
      if (promise === null) {
        promise = factory(list[index], index);
      } else {
        promise = promise.then(factory.bind(null, list[index], index));
      }
    }
    return promise || Promise.resolve();
  }

  form(name) {
    return this.request('https://raw.githubusercontent.com/loomgmbh/node-losh/' + VERSION + '/src/forms/' + name + '.json').then((content) => {
      const form = JSON.parse(content);
      const bag = {};
      if (form.description) {
        this.log.note(this.replace(form.description, bag));
      }
      return this.for(form.fields, (field, index) => {
        return this.readline('[' + (parseInt(index) + 1) + '/' + form.fields.length + '] ' + this.replace(field[1], bag) + ': ').then((content) => {
          const transformer = field[2] || '{{' + field[0] + '}}'
          bag[field[0]] = content;
          bag[field[0]] = this.replace(transformer, bag);
        });
      }).then(() => {
        return {form, bag};
      });
    });
  }

  /**
   * Get an input from the user.
   * 
   * @param {String} text 
   */
  readline(text) {
    const rl = Readline.createInterface({
      input: process.stdin,
      output: process.stdout, 
    });
    return new Promise((resolve, reject) => {
      rl.question(text, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  /**
   * Get an Input from the user, repeat if failed the check.
   * 
   * @param {String} text 
   * @param {Function} condition 
   */
  readlineWhile(text, condition) {
    return this.readline(text).then((content) => {
      const check = condition(content);

      if (typeof check === 'string') {
        this.log.error(check);
        return this.readlineWhile(text, condition);
      } else if (!check) {
        return this.readlineWhile(text, condition);
      }
      return content;
    });
  }

  readlineAccept(text) {
    return this.readlineWhile(text + ' [y/n]: ', (content) => {
      if (content !== 'y' && content !== 'n') return 'Please use "y" for yes and "n" for no.';
      return true;
    }).then((content) => {
      return content === 'y';
    });
  }

  write(path, content, force = false) {
    this.log.note('Write file [' + path + '] ...');
    return new Promise((resolve, reject) => {
      if (!force && FS.existsSync(path)) {
        this.log.warn('File already exist ...');
        this.readlineAccept('Do you want to overwrite the file?').then((accept) => {
          if (accept) {
            FS.writeFile(path, content, () => {
              resolve({path, content, created: true});
            });
          } else {
            this.log.error('Abort!');
            resolve({path, content, created: false});
          }
        });
      } else {
        FS.writeFile(path, content, () => {
          resolve({path, content, created: true});
        });
      }
    });
  }

}

class System {

  static copyArray(array) {
    let newArray = [];
    for (let index in array) {
      newArray.push(array[index]);
    }
    return newArray;
  }

  constructor(root) {
    this._log = null;
    this._root = root;
    this._commands = null;
    this._paths = null;
  }

  /**
   * @returns {Log}
   */
  get log() {
    if (this._log === null) {
      this._log = new Log(Log.codes);
    }
    return this._log;
  }

  get require() {
    return require;
  }

  get paths() {
    if (this._paths === null) {
      let cwd = process.cwd();

      this._paths = {
        cwd: cwd,
        root: this._root,
        source: Path.join(this._root, 'src'),
      };
      
      while (!FS.existsSync(Path.join(cwd, SCRIPT_DIRECTORY)) || !FS.existsSync(Path.join(cwd, 'vendor'))) {
        let ncwd = Path.join(cwd, '..');
        if (ncwd === cwd) {
          cwd = null;
          break;
        } else {
          cwd = ncwd;
        }
      }
      if (cwd) {
        this._paths.extension = Path.join(cwd, SCRIPT_DIRECTORY);
        this._paths.drupal = cwd;
      } else {
        this.log.warn('No Drupal Root found!');
      }
    }
    return this._paths;
  }

  /**
   * @returns {Object<string, import('lash/src/base/Executable')>}
   */
  get commands() {
    if (this._commands === null) {
      this._commands = {};
      this.initCommands(list);
      this.initCommands(debug);
      this.initCommands(version);
      this.initCommands(generate);
      if (this.paths.extension) {
        this.initCommands(this.paths.extension);
      }
    }
    return this._commands;
  }

  initCommands(path) {
    if (typeof path === 'string') {
      for (const file of FS.readdirSync(path)) {
        if (['.js', '.sh'].includes(Path.extname(file))) {
          const name = file.substring(0, file.length - Path.extname(file).length);
  
          this._commands[name] = Path.join(path, file);
        }
      }
    } else {
      this._commands[path.name] = path;
    }
  }

  getExecutable(name) {
    return new Executable(this, name, this.commands[name]);
  }

  execute(args) {
    const name = args.shift();

    if (this.commands[name]) {
      return this.doExecute(name, args);
    } else {
      this.log.error('Command [@command] not found!', {'@command': name});
      return this.doExecute('list', args);
    }
  }

  doExecute(name, args) {
    return this.getExecutable(name).run(args);
  }

}

// ###################
// # native commands #
// ###################

/**
 * @this {Executable} 
 * @param {Function} resolve
 * @param {Function} reject
 */
function version(resolve, reject) {
  this.log.note('Version: ' + VERSION);
};
version.params = [];
version.description = 'Show the current version.';

/**
 * @this {Executable} 
 * @param {Function} resolve
 * @param {Function} reject
 */
function generate(resolve, reject) {
  this.form('generate/' + this.args.name).then((data) => {
    return this.for(data.form.files, (template, path) => {
      return this.template(template, data.bag).then((content) => {
        const file = this.replace(Path.normalize(path), data.bag);
        this.readlineAccept('Write file [' + file + ']').then((accept) => {
          if (accept) {
            return this.write(file, content);
          } else {
            this.log.note('Abort!');
            resolve();
          }
        });
      });
    });
  });
};
generate.params = [
  ['name']
];
generate.description = 'Generator command.';

/**
 * @this {Executable} 
 * @param {Function} resolve 
 */
function debug(resolve) {
  function list(title, list) {
    console.log(title.toUpperCase());
    for (const index in list) {
      console.log('\t', [index, list[index]].join(' - '));
    }
  }

  list('paths', this.system.paths);

  this.execute(['list', 'full']).then(resolve);
};

/**
 * @this {Executable} 
 * @param {Function} resolve
 */
function list(resolve) {
  const type = this.args.type;

  function listCommands(title, commands) {
    if (type !== 'simple') console.log(title.toUpperCase());
    for (const name in commands) {
      const executable = this.system.getExecutable(name);

      if (type === 'simple') {
        console.log(executable.name);
      } else {
        const output = [executable.name];

        if (executable.description !== null) {
          output.push(executable.description);
        }
        if (type === 'usage' || type === 'full') {
          output.push('[' + executable.usage + ']');
        }
        if (type === 'full') {
          if (executable.file) {
            output.push(executable.file);
          } else {
            output.push('{native command}');
          }
        }
        console.log('\t', output.join(' - '));
      }
    }
  }

  listCommands.call(this, 'Commands', this.system.commands);
  resolve();
};
list.params = [
  ['type', 'The information', ['full', 'simple', 'usage', 'format'], 'format'],
];
list.description = 'List all commands';

// #############
// # Execution #
// #############

const system = new System(Path.dirname(__dirname));

const args = System.copyArray(process.argv);
args.shift();
args.shift();

system.execute(args);