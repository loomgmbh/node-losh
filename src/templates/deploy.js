/**
 * @this {Executable}
 */
module.exports = async function() {
  try {
    this.strict(true);
    this.log.note('Deployment [type]', {type: this.args.type});
    console.log();

    const hash = await this.git.getCurrentHash();
    const path = this.path('extension', 'currenthash.txt');

    this.log.note('Update code; Update config; Composer install; Compile theme');
    console.log();

    this.log.note('Get new code version');
    await this.git.pull();
    const newHash = await this.git.getCurrentHash();

    if (hash !== newHash) {
      this.log.note('Mark current hash [!hash] here [!path]', {'!path': this.relative(path), '!hash': hash});
      await this.write(path, hash, true);
      this.log.note('New hash [!hash]', {'!hash': newHash});
    } else {
      this.log.warn('No new commit!');
    }
    console.log();

    if (['standard', 'update'].includes(this.args.type)) {
      this.log.note('Update composer');
      await this.composer.install();
      console.log();
    }

    if (this.args.type === 'standard') {
      this.log.note('Update config');
      await this.drush.cr();
      await this.drush.cim(true);
      console.log();
    }

    // gulp
    await this.drush.cr();
    this.log.success('Finished.');
  } catch (error) {
    this.log.failed('Failed with error:');
    return {error: this.log.error(error)};
  }
};
module.exports.params = [
  ['type', 'The type of the pull.', ['standard', 'update', 'speed'], 'standard'],
];
module.exports.description = 'Standard Deploy Script';
