// Require all the things
const gulp = require('gulp'),
      connect = require('gulp-connect'),
      cp = require('child_process'),
      del = require('del'),
      bundle = require('gulp-bundle-assets');


// Set the path variables
const base_path = './',
      src = base_path + '_dev/src',
      dist = base_path + 'assets',
      paths = {  
          bundle_conf: base_path + 'bundle.config.js',
          js: src + '/js/*.js',
          scss: [ src +'/sass/*.scss', 
                  src +'/sass/**/*.scss', 
                  src +'/sass/**/**/*.scss'],
          jekyll: ['*.html', '_posts/*', '_layouts/*', '_includes/*' , 'assets/*', 'assets/**/*'],
          sass_includes: ['node_modules/foundation-sites/scss/']
      };

// bundle js & css
gulp.task('bundle', ['clean'], () => {
  return gulp.src(paths.bundle_conf)
    .pipe(bundle())
    .pipe(bundle.results({
      dest: './_data',
      pathPrefix: '/assets/',
      fileName: 'assets'
    }))
    .pipe(gulp.dest('./assets/'));
});

// Rebuild Jekyll 
gulp.task('build-jekyll', (code) => {
  return cp.spawn('jekyll', ['build'], {stdio: 'inherit'})
    .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
    .on('close', code);
});

gulp.task('clean', () => {
  return del([
    dist+'/js/**',
    dist+'/css/**',
    dist+'/maps/**'
  ]);
});

// Setup Server
gulp.task('server', () => {
  connect.server({
    root: ['_site'],
    port: 4000
  });
})

// Watch files
gulp.task('watch', () => {  
  gulp.watch(paths.scss, ['bundle']);
  gulp.watch(paths.js, ['bundle']);
  gulp.watch(paths.jekyll, ['build-jekyll']);
});

// Start Everything with the default task
gulp.task('default', [ 'bundle', 'build-jekyll', 'server', 'watch' ]);