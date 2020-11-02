/**
 * @this {Executable}
 * @param {Function} resolve 
 * @param {Function} reject
 */
module.exports = function(resolve, reject) {
  this.log.note('New command [!command]', {'!command': this.name});
};
module.exports.params = [];
module.exports.description = 'Description';
