/**
 * @this {Executable}
 */
module.exports = async function() {
  this.log.note('Deploy');
  let result = null;
  
  const hash = await this.git.getCurrentHash();
  const path = this.path('extension', 'currenthash.txt');
  this.log.note('Mark current hash [!hash] here [!path]', {'!path': this.relative(path), '!hash': hash});
  result = await this.write(path, hash, true);
  if (result.error) return;

  this.log.note('Update code; Update config; Composer install; Compile theme');
  console.log();
  this.log.note('Get new code version');
  result = await this.git.pull();
  if (result.error) return;
  const newHash = await this.git.getCurrentHash();
  this.log.note('New hash [!hash]', {'!hash': newHash});
  console.log();
  this.log.note('Update composer');
  result = await this.composer.install();
  if (result.error) return;
  console.log();
  this.log.note('Update config');
  await this.drush.cr();
  await this.drush.cim(true);
  console.log();
  // gulp
};
module.exports.params = [];
module.exports.description = 'Standard Deploy Script';
