;(function ($) {
    'use strict';
    var $body = $('html, body'),
        $site = $('#site'),
        options = {
            prefetch: true,
            pageCacheSize: 4,
            onStart: {
                duration: 500,
                render: function (url, $container) {
                    $body.animate({
                        scrollTop: 0
                    });
                    $site.addClass('is-exiting');
                    smoothState.restartCSSAnimations();
                }
            },
            onEnd: {
                duration: 0,
                render: function (url, $container, $content) {
                    $site.removeClass('is-exiting');
                    $site.html($content);
                    $body.css('cursor', 'auto');
                    $body.find('a').css('cursor', 'auto');
                }
            }
        },
        smoothState = $site.smoothState(options).data('smoothState');
})(jQuery);