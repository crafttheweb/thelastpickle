;(function ($) {
    'use strict';

    // Create the measurement node
    var scrollDiv = document.createElement("div");
    scrollDiv.className = "scrollbar-measure";
    document.body.appendChild(scrollDiv);

    // Get the scrollbar width
    var scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;

    // Delete the DIV 
    document.body.removeChild(scrollDiv);
    // does an element have overflow?
    function isOverflowed(element){
        return element.scrollWidth > element.clientWidth;
    }

    // var codeBlock = $(".code pre");
    var codeBlock = document.querySelectorAll(".highlighter-rouge pre");

    [].forEach.call(codeBlock, function(codeBlock) {
        if (isOverflowed(codeBlock)) {
            codeBlock.style.cssText = "bottom: -"+scrollbarWidth+"px";
        }
    });

    // wrap larger images in modal code
    // clock to show larger versions
    $(".content").imagesLoaded( function() {
          // images have loaded
         $("img").each(function() {
            var $this = $(this);
            var image = new Image();
            image.src = $this.attr("src");
            // 970 is as images at max-width: 160%;
            if (image.naturalWidth > 970) {
                // add wide class
                $this.addClass("wide");
                // wrap in link
                $this.wrap("<a href='"+image.src+"' class='show-modal'></a>");
            }
            // init modaal code
            $('.show-modal').modaal({
                type: 'image'
            });
         });
    });



})(jQuery);