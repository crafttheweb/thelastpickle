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

    $(".content").imagesLoaded( function() {
          // images have loaded
         $("img").each(function() {
            var $this = $(this);
            var image = new Image();
            image.src = $this.attr("src");
            // console.log('width: ' + image.naturalWidth);
            if (image.naturalWidth > 970) {
                $this.addClass("wide");
                $this.wrap("<a href='"+image.src+"' class='show-modal'></a>");
            }
             $('.show-modal').modaal({
                type: 'image'
             });
         });
    });

        // add classes to images that are wider than 800px


})(jQuery);