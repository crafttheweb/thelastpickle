// Set the path variables
const base_path = './',
      src = base_path + '_dev/src',
      dist = base_path + 'assets',
      paths = {  
          js: src + '/js/*.js',
          scss: [ src +'/sass/*.scss', 
                  src +'/sass/**/*.scss', 
                  src +'/sass/**/**/*.scss'],
          sass_includes: ['node_modules/foundation-sites/scss/']
      },
      sass = require('gulp-sass'),
      minifyCSS = require('gulp-minify-css'),
      prefixer = require('gulp-autoprefixer'),
      lazypipe = require('lazypipe');

var styleTransforms = lazypipe()
    .pipe(sass, {includePaths: paths.sass_includes})
    .pipe(prefixer, {browsers: ['last 2 versions', 'ie 9']});

module.exports = {
  bundle: {
    'js/main': {
      scripts: paths.js
    },
    'css/style': {
      styles: paths.scss,
      options: {
        transforms: {
          styles: styleTransforms
        }
      }
    },
    'js/vendor': {
      scripts: [
        './node_modules/jquery.1/node_modules/jquery/dist/jquery.min.js'
      ],
      options: {
        uglify: false // don't minify js since bower already ships with one
      }
    }
  }
};