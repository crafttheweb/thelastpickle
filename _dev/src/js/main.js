;(function ($) {
    'use strict';

    var TLP = TLP || {};

    TLP.images = {
        init: function() {
          // loop through all images in the .content element
         $(".content img").each(function() {
            var $this = $(this);

            // need to create img JS obj to check naturalWidth
            var image = new Image();
            image.src = $this.attr("src");

            // with wide images we're using CSS to increase the max-wide
            // to 160% which is 970px;
            // If the images are wider than than number add the .wide class
            if (image.naturalWidth > 970) {
                // add wide class
                $this.addClass("wide");
                // wrap in link so we can trigger the Modaal call below.
                $this.wrap("<a href='"+image.src+"' class='show-modal'></a>");
            }

            // init modaal code
            $('.show-modal').modaal({
                type: 'image'
            });
         });
        }
    };

    // As assumption is that if you're using a blockquote and you want
    // a citation you're going to to id like this: - Person Name
    // This code is going to look for the last - charager and wrap whatever
    // comes after it in a <cite> element.
    // Good luck
    TLP.citations = {
             
        init: function() {
            $("blockquote p").replaceText( /([\s\w]+)[\–](.+)/i, "<cite>$2<\/cite>" );
        }

    };

    TLP.citations.init();

    // using external JQ plugin to check if images are loaded
    // images are stupid btw.
    $(".content").imagesLoaded( function() {
        TLP.images.init();
    });

})(jQuery);