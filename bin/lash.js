#!/usr/bin/env node

const FS = require('fs');
const Path = require('path');
const Spawn = require('child_process').spawn;

const SCRIPT_DIRECTORY = 'loom';

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

class Executable {

  /**
   * @param {System} system 
   * @param {string} name
   * @param {string} file 
   */
  constructor(system, name, file) {
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

  get log() {
    return this.system.log;
  }

  get require() {
    return this.system.require;
  }

  get extname() {
    if (this.file === null) return '.js';
    return Path.extname(this.file);
  }

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

  get description() {
    return this.factory && this.factory.description || null;
  }

  get usage() {
    const output = ['lash', this.name];

    if (this.params.length) {
      for (const param of this.params) {
        output.push(param.usage);
      }
    }
    return output.join(' ');
  }

  path(cwd = 'drupal', ...paths) {
    return Path.join(this.system.paths[cwd], ...paths);
  }

  execute(args) {
    return this.system.execute(args);
  }

  shell(args, cwd = null, listeners = {}, inherit = true) {
    return new Promise((resolve, reject) => {
      const options = {
        cwd: cwd || this.system.paths.drupal || process.cwd(),
      };
      if (inherit) {
        options.stdio = 'inherit';
        options.shell = true;
      }
      const shellCommand = Spawn('sh', args, options);
  
      for (const event in listeners) {
        shellCommand.on(event, listeners[event]);
      }
      if (listeners.error === undefined) {
        shellCommand.on('error', error => {
          this.system.log.error(error.message);
          reject(error);
        });
      }
      shellCommand.on('close', code => resolve(code));
    });
  }

  run(args) {
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
    return this.doRun();
  }

  doRun() {
    switch (this.extname) {
      case '.js':
        return new Promise((resolve, reject) => {
          return this.factory.call(this, resolve, reject);
        });
      case '.sh':
        return this.shell([this.file, ...this.args]);
      default: 
        this.log.error('The extname [@extname] is unknown.', {'@extname': this.extname});
        return Promise.reject();
    }
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
      this.initCommands(addCommand);
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

// # Base commands

/**
 * @this {Executable} 
 * @param {Function} resolve
 * @param {Function} reject
 */
function addCommand(resolve) {
  const [ name ] = this.args;
  const file = this.path('extension', name + '.js');

  if (!name) {
    this.log.error('The argument [!name] is required!', {'!name': 'name'});
  } else if (this.system.commands[name] || FS.existsSync(file)) {
    this.log.error('The command [!command] already exist.', {'!command': name});
  } else {
    const content = [
      '/**',
      ' * @this {Executable}',
      ' * @param {Function} resolve',
      ' * @param {Function} reject',
      ' */',
      'module.exports = function(resolve, reject) {',
      '  const [ ] = this.args;',
      '  ',
      '  this.log.note(\'New command [!command]\', {\'!command\': \'' + name + '\'});',
      '};',
      'module.exports.params = [];',
      'module.exports.description = \'Description\';',
    ];
    FS.writeFile(file, content.join('\n'), () => {
      this.log.note('Created command [!file]', {'!file': file});
      resolve();
    });
  }
};
addCommand.params = [
  ['!command-name', 'The command name of the new command.'],
  ['!template', 'The template for the command.', null, 'command']
];
addCommand.description = 'Create a new Command in this project.';

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

  list('paths', exe.system.paths);

  this.execute(['list', 'full']).then(resolve);
};

/**
 * @this {Executable} 
 * @param {Function} resolve
 */
function list(resolve) {
  const type = this.args.type;
  console.log(this.args);

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
            output.push('{native code}');
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

// # Execution

const system = new System(Path.dirname(__dirname));

const args = System.copyArray(process.argv);
args.shift();
args.shift();

system.execute(args);