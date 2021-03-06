#!/usr/bin/env node

const FS = require('fs');
const Path = require('path');
const ShellSpawn = require('child_process').spawn;
const ShellExec = require('child_process').exec;
const HTTPS = require('https');
const OS = require('os');
const Readline = require('readline');

const win = OS.platform() === 'win32';

const SCRIPT_NAME = 'losh';
const SCRIPT_DIRECTORY = 'loom';
const VERSION = 'main';

class LoshError extends Error {

  constructor(...args) {
    super(...args);
    this.printed = false;
  }

}
class ReplaceLoshError extends LoshError {}

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

  replace(message, placeholders = {}) {
    for (const index in placeholders) {
      if (this.logs[index[0]] === undefined) {
        message = message.replace(new RegExp('\\[' + index + '\\]', 'g'), placeholders[index]);
      } else {
        message = message.replace(new RegExp('\\[' + index + '\\]', 'g'), this.insertStyle(message, this.logs[index[0]](placeholders[index])));
      }
    }
    return message;
  }

  note(message, placeholders = {}) {
    console.log(this.replace(this.color.blue(message), placeholders));
  }

  warn(message, placeholders = {}) {
    message = '[WARN]: ' + message;
    console.warn(this.replace(this.color.yellow(message), placeholders));
  }

  error(message, placeholders = {}) {
    let error = this.getError(message);

    if (error) {
      if (!error.printed) {
        console.error(this.color.red('[ERROR]: ' + error.message + (typeof placeholders === 'string' ? ' ' + placeholders : '')));
        error.printed = true;
      }
    } else {
      console.error(this.replace(this.color.red('[ERROR]: ' + message), placeholders));
      error = new LoshError(message);
      error.printed = true;
    }
    return error;
  }

  success(message, placeholders = {}) {
    message = '[SUCCESS]: ' + message;
    console.log(this.replace(this.bg.green(message), placeholders));
  }

  failed(message, placeholders = {}, full = false) {
    let error = this.getError(message);

    if (error) {
      if (!error.printed) {
        let add = '';
        if (error.stricted) {
          add = 'Abort caused by strict mode. ';
        }
        if (full) {
          add += error.stack;
        } else {
          add += error.message
        }
        console.error(this.bg.red('[FAILED]: ' + add + (typeof placeholders === 'string' ? ' ' + placeholders : '')));
        error.printed = true;
      }
    } else {
      console.error(this.replace(this.bg.red('[FAILED]: ' + message), placeholders));
      error = new LoshError(message);
      error.printed = true;
    }
    return error;
  }

  /**
   * @param {(string|Object|Error)} message 
   * @returns {Error}
   */
  getError(message) {
    if (message instanceof Error || message.error instanceof Error) {
      return message.error || message;
    }
    return null;
  }

}

class ShellCommand {

  get command() { return null; }

  /**
   * @param {Executable} executable 
   */
  constructor(executable) {
    this._executable = executable;
    this._command = null;
  }

  getCommand() {
    if (this._command === null) {
      if (win) {
        this._command = this.command.replace(/\\/g, '/');
      } else {
        this._command = this.command;
      }
    }
    return this._command;
  }

  async exec(command) {
    return this._executable.checkError(await this._executable.exec(command));
  }

  shc(...args) {
    return this.exec('sh -c "' + this.getCommand() + ' ' + args.join(' ') + '"');
  }

  async sh(...args) {
    return this._executable.checkError(await this._executable.sh(args));
  }

  async shell(...args) {
    return this._executable.checkError(await this._executable.shell(args));
  }

  shellc(...args) {
    return this.shell('sh', '-c', '"' + this.getCommand() + ' ' + args.join(' ') + '"');
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
    return this.execute('checkout', branch);
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

  pull() {
    return this.execute('pull');
  }

  push() {
    return this.execute('push');
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

  /**
   * Channel for "drush sql-cli 'query'"
   * 
   * @param {string} query
   * @returns {Promise<ExecResult>}
   */
  sqlCli(query) {
    return this.exec(['echo', query, '|', '"' + this.getCommand() + '"', 'sql-cli'].join(' '));
  }

  /**
   * @param {string} query 
   * @returns {Promise<Object<string, any>[]>}
   */
  async sqlSelect(query) {
    const data = await this.sqlCli(query);
    const lines = data.out.split((win ? '\r\n' : '\n'));
    const header = lines.shift().split('\t');
    const rows = [];
    
    for (const index in lines) {
      if (lines[index].trim().length) {
        const result = lines[index].split('\t');
        const row = {};
        for (const i in header) {
          row[header[i]] = result[i];
        }
        rows.push(row);
      }
    }
  
    return rows;
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
    return this.shellc('install');
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
    this._strict = false;
    if (typeof file === 'string') {
      this.file = file;
      this._factory = undefined;
    } else {
      this.file = null;
      this._factory = file;
    }
  }

  async init() {
    
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
   * @returns {string}
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
   * @returns {string}
   */
  get description() {
    return this.factory && this.factory.description || null;
  }

  /**
   * Returns a string for command to show an usage example.
   * 
   * @returns {string}
   */
  get usage() {
    const output = ['losh', this.name];

    if (this.params.length) {
      for (const param of this.params) {
        output.push(param.usage);
      }
    }
    return output.join(' ');
  }

  checkError(result) {
    if (result instanceof Error || result.error instanceof Error) {
      if (this._strict) {
        (result.error || result).stricted = true;
        throw result;
      } else {
        this.log.error(result);
      }
    }
    return result;
  }

  strict(boolean) {
    this._strict = boolean;
  }

  async which(command) {
    const result = await this.exec('where ' + command);
    return result.out.trim();
  }

  /**
   * Create a path with a starting path. 
   * 
   * @param {string} cwd The base path [root, drupal, source]
   * @param  {...string} paths 
   * @returns {string}
   */
  path(cwd = 'drupal', ...paths) {
    return Path.join(this.system.paths[cwd], ...paths);
  }

  /**
   * Create a path with a starting path and truncate it to relative drupal path.
   * 
   * @param {string} path 
   * @param  {string} cwd The base path [root, drupal, source] 
   * @returns {string}
   */
  relative(path, cwd = 'drupal') {
    if (path.startsWith(this.system.paths[cwd])) {
      path = '.' + path.substring(this.system.paths[cwd].length);
    }
    return path;
  }

  /**
   * Execute a command with the launcher.
   * 
   * @param {string[]} args 
   */
  execute(args) {
    return this.system.execute(args);
  }

  /**
   * Execute commanc compatible mode.
   * 
   * @param {string} command full command
   * @returns {Promise<ExecResult>}
   * 
   * @typedef {Object} ExecResult
   * @property {Error} error
   * @property {string} out
   * @property {string} err
   */
  exec(command) {
    return new Promise((resolve) => {
      ShellExec(command, (error, out, err) => {
        resolve({error, out, err});
      });
    });
  }

  /**
   * Catch the output of a shell command.
   * 
   * @param {string[]} args 
   * @param {string} cwd 
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
          data.error = new LoshError('Exit with code: ' + code);
          reject(data);
        }
      });
    });
  }

  /**
   * Channel execution of shell command.
   * 
   * @param {string[]} args 
   * @param {string} cwd 
   * @returns {Promise<Object>}
   */
  shell(args, cwd = null) {
    return new Promise((resolve, reject) => {
      const options = {
        cwd: cwd || this.system.paths.drupal || process.cwd(),
        shell: true,
        stdio: 'inherit',
      };

      const command = ShellSpawn(args.shift(), args, options);

      command.on('error', error => {
        this.system.log.error(error.message);
        reject({ error });
      });

      command.on('close', code => {
        if (code === 0) {
          resolve({ code })
        } else {
          resolve({ code, error: new LoshError('Exit with code: ' + code) });
        }
      });
    });
  }

  /**
   * Execute the command.
   * 
   * @param {string[]} args 
   * @returns {Promise<RunResult>}
   * 
   * @typedef {Object} RunResult
   * @property {string[]} args
   * @property {Executable} executable
   * @property {Error} [error]
   */
  async run(args) {
    this._args = args;
    this.args = {
      _: [],
    };
    if (this.params.length) {
      for (let i = 0; i < (args.length < this.params.length ? this.params.length : args.length); i++) {
        if (this.params[i]) {
          this.args[this.params[i].name] = args[i] || this.params[i].fallback;
          if (this.params[i].required && this.args[this.params[i].name] === null) {
            return {args, executable: this, error: this.log.error('The argument [!argument] is required!', {'!argument': this.params[i].name})};
          }
        } else {
          this.args._.push(args[i]);
        }
      }
    }
    
    try {
      await this.init();
      switch (this.extname) {
        case '.js':
          const data = (await this.factory.call(this)) || {};
  
          data.args = args;
          data.executable = this;
          return data;
        case '.sh':
          return this.shell(['sh', this.file, ...this._args]);
        default: 
          return {args, executable: this, error: this.log.error('The extname [@extname] is unknown.', {'@extname': this.extname})};
      }
    } catch (error) {
      console.log(error);
      this.log.failed(error, 'Uncaught!', true);
      return error;
    }
  }

  /**
   * HTTPS request a file.
   * 
   * @param {string} url 
   * @returns {Promise<RequestResult>}
   * 
   * @typedef {Object} RequestResult
   * @property {string} content
   * @property {string} url
   * @property {Error} [error]
   */
  request(url) {
    return new Promise((resolve, reject) => {
      this.log.note('Request [' + url + '] ...');
      HTTPS.get(url, (response) => {
        if (response.statusCode !== 200) {
          return reject({url, error: this.log.error(response.statusCode + ' - ' + response.statusMessage + ' [' + url + ']')});
        }
        let content = '';
        
        response.on('data', (chunk) => {
          this.log.note('Get content (' + chunk.length + ' b) ...');
          content += chunk;
        });
        response.on('end', () => {
          this.log.note('Received data (' + content.length + ' b) ...');
          resolve({content, url});
        });
      });
    });
  }

  /**
   * @param {string} content 
   * @param {Object<string, string>} bag 
   * @param {boolean} strict
   * @returns {string|null}
   */
  replace(content, bag = {}, strict = false) {
    let breaked = false;
    content = content.replace(new RegExp('\\{\\{([^!a-zA-Z0-9]*)(!?[a-zA-Z0-9]+)([^!a-zA-Z0-9]*)\\}\\}', 'g'), (substring, ...args) => {
      let selected = args[1];
  
      if (selected.startsWith('!')) {
        selected = selected.substring(1);
        if (bag[selected] === null || bag[selected] === undefined) {
          breaked = true;
          return '';
        }
      }
      return (bag[selected]) ? args[0] + bag[selected] + args[2] : '';
    });
    if (breaked) {
      if (strict) {
        throw new ReplaceLoshError('One or more required placeholders are not set in bag.');
      } else {
        return null;
      }
    }
    content = content.replace(new RegExp('@(!?[a-z]+)', 'g'), (substring, ...args) => {
      let selected = args[0];
      
      if (selected.startsWith('!')) {
        if (this.system.paths[selected.substring(1)]) {
          return this.system.paths[selected.substring(1)];
        } else {
          breaked = true;
          return '';
        }
      } else {
        return this.system.paths[selected] || substring;
      }
    });
    if (breaked) {
      if (strict) {
        throw new ReplaceLoshError('One or more required placeholders are not set in bag.');
      } else {
        return null;
      }
    }
    return content;
  }

  /**
   * HTTPS request a template and replace placeholders.
   * 
   * @param {string} template 
   * @param {Object<string, string>} placeholders 
   * @returns {Promise<String>}
   */
  async template(template, placeholders = {}) {
    const data = await this.request('https://raw.githubusercontent.com/loomgmbh/node-losh/' + VERSION + '/src/templates/' + template);
    this.log.note('Replace placeholders in template ...');
    return this.replace(data.content, placeholders);
  }

  /**
   * Execute a formular JSON.
   * 
   * @param {string} name 
   * @returns {Promise<FormResult>}
   * 
   * @typedef {Object} FormResult
   * @property {string} name
   * @property {LoshForm} form
   * @property {Object<string, string>} bag
   * @property {Error} [error]
   * 
   * @typedef {Object} LoshForm
   * @property {string} description
   * @property {string[]} fields
   * @property {Object<string, string>} files
   */
  async form(name) {
    const data = await this.request('https://raw.githubusercontent.com/loomgmbh/node-losh/' + VERSION + '/src/forms/' + name + '.json');
    if (data.error) return {name, error: data.error};
    const form = JSON.parse(data.content);
    const bag = {};

    if (form.description) {
      this.log.note(this.replace(form.description, bag));
    }

    for (const index in form.fields) {
      const required = !form.fields[index][0].startsWith('?');
      if (!required) {
        form.fields[index][0] = form.fields[index][0].substring(1);
      }
      const input = await this.readlineWhile('[' + (parseInt(index) + 1) + '/' + form.fields.length + '] ' + this.replace(form.fields[index][1], bag) + ': ', required);
      if (input.error) return {name, form, bag, error: input.error};
      const transformer = form.fields[index][2] || '{{' + form.fields[index][0] + '}}'
      bag[form.fields[index][0]] = input.answer;
      const value = this.replace(transformer, bag);
      if (value) {
        bag[form.fields[index][0]] = value; 
      } else {
        delete bag[form.fields[index][0]];
      }
    }
    return {name, form, bag};
  }

  /**
   * Get an input from the user.
   * 
   * @param {string} text
   * @returns {Promise<ReadlineResult>}
   * 
   * @typedef {Object} ReadlineResult
   * @property {string} answer
   * @property {Error} [error]
   */
  readline(text) {
    const rl = Readline.createInterface({
      input: process.stdin,
      output: process.stdout, 
    });
    return new Promise((resolve) => {
      rl.question(text, (answer) => {
        rl.close();
        resolve({answer});
      });
    });
  }

  /**
   * Get an Input from the user, repeat if failed the check.
   * 
   * @param {string} text 
   * @param {(ReadlineCondition|string|boolean)} condition 
   * @returns {Promise<ReadlineResult>}
   * 
   * @callback ReadlineCondition
   * @param {ReadlineResult} input
   * @returns {(boolean|string)}
   */
  async readlineWhile(text, condition = false) {
    if (typeof condition !== 'function' && condition !== false) {
      const failure = (typeof condition === 'string' ? condition : 'Require input!');
      condition = (input) => {
        if (!input.answer.length) return failure;
        return true;
      };
    } else if (condition === false) {
      condition = () => {return true;};
    }
    let input = null;
    let check = null;
    do {
      input = await this.readline(text);
      if (input.error) return input;
      check = condition(input);
      if (typeof check === 'string') {
        this.log.error(check);
      } else if (!check) {
        this.log.error('Invalid input.');
      }
    } while (check !== true);
    return input;
  }

  /**
   * Request a consent from the user.
   * 
   * @param {string} text 
   * @returns {boolean}
   */
  async readlineAccept(text) {
    const input = await this.readlineWhile(text + ' [y/n]: ', (input) => {
      if (input.answer !== 'y' && input.answer !== 'n') return 'Please use "y" for yes and "n" for no.';
      return true;
    });
    if (input.error) throw input.error;
    return input.answer === 'y';
  }

  /**
   * Write a file.
   * 
   * @param {string} path 
   * @param {string} content 
   * @param {boolean} force 
   * @returns {Promise<WriteResult>}
   * 
   * @typedef {Object} WriteResult
   * @property {string} path
   * @property {string} content
   * @property {boolean} force
   * @property {boolean} consent
   * @property {Error} [error]
   */
  async write(path, content, force = false) {
    try {
      this.log.note('Write file [!path] ...', {'!path': path});
      let consent = false;
      if (!force && FS.existsSync(path)) {
        consent = await this.readlineAccept('Do you want to overwrite the file?');
        if (!consent) {
          return this.checkError({path, content, force, consent, error: this.log.error('No user consent to overwrite. Abort!')});
        }
      }
    
      FS.writeFileSync(path, content);
      return {path, content, force, consent};
    } catch (error) {
      if (error.error) return this.checkError(error);
      return this.checkError({path, content, force, error});
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
      const home = Path.join(OS.homedir(), '.' + SCRIPT_NAME);
      if (FS.existsSync(home)) {
        this._paths.home = home;
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
      this.initCommands(cr);
      this.initCommands(cex);
      this.initCommands(cim);
      this.initCommands(version);
      this.initCommands(debug);
      this.initCommands(list);
      this.initCommands(generate);
      this.initCommands(test);
      this.initCommands(install);
      this.initCommands(uninstall);
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

  async execute(args) {
    const name = args.shift();

    if (this.commands[name]) {
      return this.getExecutable(name).run(args);
    } else {
      const data = await this.getExecutable('list').run(args);
      data.error = this.log.error('Command [@command] not found!', {'@command': name});
      return data;
    }
  }

}

// ###################
// # native commands #
// ###################

/**
 * @this {Executable}
 */
function version() {
  this.log.note('Version: ' + VERSION);
};
version.params = [];
version.description = 'Show the current version.';

/**
 * @this {Executable}
 */
async function cr() {
  await this.drush.cr();
};
cr.description = 'Default cr function.';

/**
 * @this {Executable}
 */
async function cim() {
  await this.drush.cim();
};
cim.description = 'Default cim function.';

/**
 * @this {Executable}
 */
async function cex() {
  await this.drush.cex();
};
cex.description = 'Default cex function.';

/**
 * @this {Executable} 
 */
async function generate() {
  try {
    const form = await this.form('generate/' + this.args.name);

    const files = {};
    for (const path in form.form.files) {
      const template = await this.template(form.form.files[path], form.bag);
      try {
        files[this.replace(Path.normalize(path), form.bag, true)] = template;
      } catch (e) {
        if (e instanceof ReplaceLoshError) {
          throw this.log.error('File [!path] can not be generated because: [message]', {'!path': path, message: e.message});
        }
        throw e;
      }
    }
    this.log.note('Would generate this files:');
    for (const file in files) {
      if (FS.existsSync(file)) {
        this.log.warn('Exists ' + file);
      } else {
        this.log.note(file);
      }
    }
    const accept = await this.readlineAccept('Write file');
    if (accept) {
      for (const file in files) {
        const result = await this.write(file, files[file], true);
        if (result.error) return;
      }
    } else {
      this.log.error('No consent. Abort!');
      return;
    }
  } catch (error) {
    this.log.failed(error);
    return error;
  }
};
generate.params = [
  ['name']
];
generate.description = 'Generator command.';

/**
 * @this {Executable}
 */
async function install() {
  const pack = this.args.package;
  const home = Path.join(OS.homedir(), '.' + SCRIPT_NAME);

  if (pack) {

  } else {
    this.log.note('Install ' + SCRIPT_NAME + ' on this system.');
    if (FS.existsSync(home)) {
      return {error: this.log.error('The script ' + SCRIPT_NAME + ' is already installed! Abort!')};
    }
    FS.mkdirSync(home);
    this.system._paths.home = home;
    const result = await this.execute(['generate', 'install']);
    console.log(result);
  }
};
install.params = [
  ['package', 'The name of the package.'],
];
install.description = 'Install the script for extensions and configs. (Optional)';

async function uninstall() {

};
uninstall.description = 'Uninstall the script.';

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
 */
async function test() {
  const bag = {
    'e': 'cool',
    'd': 'huhu',
    'c': null,
  };
  const subject = '{{a }}{{!b }}{{c }}{{d }}{{a }}{{|a | }}{{|  !b|}}@homed';
  const result = this.replace(subject, bag);
  console.log(result);
};

/**
 * @this {Executable} 
 */
function list() {
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