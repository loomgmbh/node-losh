/**
 * @this {Executable}
 * @param {Function} resolve 
 * @param {Function} reject
 */
module.exports = function(resolve, reject) {
  this.log.note('Deploy ...');

  const promises = [
    this.composer.install,
    this.drush.cr,
    this.drush.cim.bind(this.drush, true),
  ];
  this.for(promises).then(() => {
    this.log.note('Finished ...');
  });
};
module.exports.params = [];
module.exports.description = 'Deploy script.';
