!function(e){e.fn.replaceText=function(n,t,i){return this.each(function(){var o,r,l=this.firstChild,u=[];if(l)do 3===l.nodeType&&(o=l.nodeValue,r=o.replace(n,t),r!==o&&(!i&&/</.test(r)?(e(l).before(r),u.push(l)):l.nodeValue=r));while(l=l.nextSibling);u.length&&e(u).remove()})}}(jQuery);
!function(i){"use strict";var t=t||{};t.images={init:function(){i(".content img").each(function(){var t=i(this),a=new Image;a.src=t.attr("src"),a.naturalWidth>970&&(t.addClass("wide"),t.wrap("<a href='"+a.src+"' class='show-modal'></a>")),i(".show-modal").modaal({type:"image"})})}},t.citations={init:function(){i("blockquote p").replaceText(/([\s\w]+)[\–](.+)/i,"<cite>$2</cite>")}},t.citations.init(),i(".content").imagesLoaded(function(){t.images.init()})}(jQuery);
!function(a){var t=a("body"),e='<button type="button" class="modaal-close" id="modaal-close" aria-label="Close (Press escape to close)"><span>Close</span></button>',o='<div class="modaal-loading-spinner"><div><div></div></div><div><div></div></div><div><div></div></div><div><div></div></div><div><div></div></div><div><div></div></div><div><div></div></div><div><div></div></div></div>',i={init:function(t,o){var i=this;i.$elem=a(o),i.options=a.extend({},a.fn.modaal.options,i.$elem.data(),t),i.xhr=null,i.scope={is_open:!1,id:"modaal_"+(new Date).getTime()+Math.random().toString(16).substring(2)},i.$elem.attr("data-modaal-scope",i.scope.id),i.private_options={active_class:"is_active"},i.lastFocus=null,i.options.is_locked||"confirm"==i.options.type||i.options.hide_close?i.scope.close_btn="":i.scope.close_btn=e,"none"===i.options.animation&&(i.options.animation_speed=0,i.options.after_callback_delay=0),a(o).on("click.Modaal",function(a){a.preventDefault();var t;switch(i.lastFocus=document.activeElement,i.options.before_open.call(i,a),i.options.type){case"inline":i.create_basic();break;case"ajax":t=i.options.source(i.$elem,i.$elem.attr("href")),i.fetch_ajax(t);break;case"confirm":i.options.is_locked=!0,i.create_confirm();break;case"image":i.create_image();break;case"iframe":t=i.options.source(i.$elem,i.$elem.attr("href")),i.create_iframe(t);break;case"video":i.create_video(i.$elem.attr("href"));break;case"instagram":i.create_instagram()}i.watch_events()}),i.options.start_open===!0&&a(o).click()},watch_events:function(){var e=this;t.off("click.Modaal keyup.Modaal keydown.Modaal"),t.on("keydown.Modaal",function(t){var o=t.keyCode,i=t.target;9==o&&e.scope.is_open&&(a.contains(document.getElementById(e.scope.id),i)||a("#"+e.scope.id).find('*[tabindex="0"]').focus())}),t.on("keyup.Modaal",function(t){var o=t.keyCode;return t.target,!e.options.is_locked&&27==o&&e.scope.is_open?a(document.activeElement).is("input")?!1:void e.modaal_close():"image"==e.options.type?(37==o&&e.scope.is_open&&!a("#"+e.scope.id+" .modaal-gallery-prev").hasClass("is_hidden")&&e.gallery_update("prev"),void(39==o&&e.scope.is_open&&!a("#"+e.scope.id+" .modaal-gallery-next").hasClass("is_hidden")&&e.gallery_update("next"))):void 0}),t.on("click.Modaal",function(t){var o=a(t.target);if(!e.options.is_locked&&(e.options.overlay_close&&o.is(".modaal-inner-wrapper")||o.is(".modaal-close")))return void e.modaal_close();if(o.is(".modaal-confirm-btn"))return o.is(".modaal-ok")&&e.options.confirm_callback.call(e,e.lastFocus),void e.modaal_close();if(o.is(".modaal-gallery-control")){if(o.hasClass("is_hidden"))return;return o.is(".modaal-gallery-prev")&&e.gallery_update("prev"),void(o.is(".modaal-gallery-next")&&e.gallery_update("next"))}})},build_modal:function(a){var e=this,o="";"instagram"==e.options.type&&(o=" modaal-instagram");var i,l="video"==e.options.type?"modaal-video-wrap":"modaal-content";switch(e.options.animation){case"fade":i=" modaal-start_fade";break;case"slide-down":i=" modaal-start_slidedown";break;default:i=" modaal-start_none"}var n="";e.options.fullscreen&&(n=" modaal-fullscreen"),""===e.options.custom_class&&"undefined"==typeof e.options.custom_class||(e.options.custom_class=" "+e.options.custom_class);var s='<div class="modaal-wrapper modaal-'+e.options.type+i+o+n+e.options.custom_class+'" id="'+e.scope.id+'"><div class="modaal-outer-wrapper"><div class="modaal-inner-wrapper">';"video"!=e.options.type&&(s+='<div class="modaal-container">'),s+='<div class="'+l+'" aria-hidden="false" aria-label="'+e.options.accessible_title+' (Press escape to close)" role="dialog">',s+="inline"==e.options.type?'<div class="modaal-content-container"></div>':a,s+="</div>"+e.scope.close_btn,"video"!=e.options.type&&(s+="</div>"),s+="</div></div></div>",t.append(s),"inline"==e.options.type&&a.appendTo("#"+e.scope.id+" .modaal-content-container"),e.modaal_overlay("show")},create_basic:function(){var t=this,e=t.$elem.is("[href]")?a(t.$elem.attr("href")):t.$elem,o="";e.length?(o=e.children().clone(!0,!0),e.empty()):o="Content could not be loaded. Please check the source and try again.",t.build_modal(o)},create_instagram:function(){var t=this,e=t.options.instagram_id,o="",i="Instagram photo couldn't be loaded, please check the embed code and try again.";if(t.build_modal('<div class="modaal-content-container'+(""!=t.options.loading_class?" "+t.options.loading_class:"")+'">'+t.options.loading_content+"</div>"),""!=e&&null!==e&&void 0!==e){var l="https://api.instagram.com/oembed?url=http://instagr.am/p/"+e+"/";a.ajax({url:l,dataType:"jsonp",cache:!1,success:function(e){o=e.html;var i=a("#"+t.scope.id+" .modaal-content-container");i.length>0&&(i.removeClass(t.options.loading_class),i.html(o),window.instgrm.Embeds.process())},error:function(){o=i;var e=a("#"+t.scope.id+" .modaal-content-container");e.length>0&&(e.removeClass(t.options.loading_class).addClass(t.options.ajax_error_class),e.html(o))}})}else o=i;return!1},fetch_ajax:function(t){var e=this;null==e.options.accessible_title&&(e.options.accessible_title="Dialog Window"),null!==e.xhr&&(e.xhr.abort(),e.xhr=null),e.build_modal('<div class="modaal-content-container'+(""!=e.options.loading_class?" "+e.options.loading_class:"")+'">'+e.options.loading_content+"</div>"),e.xhr=a.ajax(t,{success:function(t){var o=a("#"+e.scope.id).find(".modaal-content-container");o.length>0&&(o.removeClass(e.options.loading_class),o.html(t),e.options.ajax_success.call(e,o))},error:function(t){if("abort"!=t.statusText){var o=a("#"+e.scope.id+" .modaal-content-container");o.length>0&&(o.removeClass(e.options.loading_class).addClass(e.options.ajax_error_class),o.html("Content could not be loaded. Please check the source and try again."))}}})},create_confirm:function(){var a,t=this;a='<div class="modaal-content-container"><h1 id="modaal-title">'+t.options.confirm_title+'</h1><div class="modaal-confirm-content">'+t.options.confirm_content+'</div><div class="modaal-confirm-wrap"><button type="button" class="modaal-confirm-btn modaal-ok" aria-label="Confirm">'+t.options.confirm_button_text+'</button><button type="button" class="modaal-confirm-btn modaal-cancel" aria-label="Cancel">'+t.options.confirm_cancel_button_text+"</button></div></div></div>",t.build_modal(a)},create_image:function(){var t,e,o=this,i="",l='<button type="button" class="modaal-gallery-control modaal-gallery-prev" id="modaal-gallery-prev" aria-label="Previous image (use left arrow to change)"><span>Previous Image</span></button>',n='<button type="button" class="modaal-gallery-control modaal-gallery-next" id="modaal-gallery-next" aria-label="Next image (use right arrow to change)"><span>Next Image</span></button>';if(o.$elem.is("[rel]")){var s=o.$elem.attr("rel"),d=a('[rel="'+s+'"]');d.removeAttr("data-gallery-active","is_active"),o.$elem.attr("data-gallery-active","is_active"),e=d.length-1;var r=[];i='<div class="modaal-gallery-item-wrap">',d.each(function(a,t){var e="",o="",i="",l=!1,n=t.getAttribute("data-modaal-desc"),s=t.getAttribute("data-gallery-active");""!==t.href||void 0!==t.href?e=t.href:""===t.src&&void 0===t.src||(e=t.src),""!=n&&null!==n&&void 0!==n?(o=n,i='<div class="modaal-gallery-label"><span class="modaal-accessible-hide">Image '+(a+1)+" - </span>"+n+"</div>"):i='<div class="modaal-gallery-label"><span class="modaal-accessible-hide">Image '+(a+1)+"</span></div>",s&&(l=!0);var d={url:e,alt:o,desc:i,active:l};r.push(d)});for(var c=0;c<r.length;c++){var m="";r[c].active&&(m=" "+o.private_options.active_class),i+='<div class="modaal-gallery-item gallery-item-'+c+m+'"><img src="'+r[c].url+'" alt=" ">'+r[c].desc+"</div>"}i+="</div>"+l+n}else{var p=o.$elem.attr("href"),v="",_="";o.$elem.attr("data-modaal-desc")&&(v=o.$elem.attr("data-modaal-desc"),_='<div class="modaal-gallery-label"><span class="modaal-accessible-hide">Image - </span>'+v+"</div>"),i='<div class="modaal-gallery-item is_active"><img src="'+p+'" alt="'+v+'">'+_+"</div>"}t=i,o.build_modal(t),a(".modaal-gallery-item.is_active").is(".gallery-item-0")&&a(".modaal-gallery-prev").hide(),a(".modaal-gallery-item.is_active").is(".gallery-item-"+e)&&a(".modaal-gallery-next").hide()},gallery_update:function(t){var e=this,o=a("#"+e.scope.id),i=o.find(".modaal-gallery-item"),l=i.length-1;if(0==l)return!1;var n=o.find(".modaal-gallery-prev"),s=o.find(".modaal-gallery-next"),d=250,r=0,c=0,m=o.find(".modaal-gallery-item."+e.private_options.active_class),p="next"==t?m.next(".modaal-gallery-item"):m.prev(".modaal-gallery-item");return e.options.before_image_change.call(e,m,p),"prev"==t&&o.find(".gallery-item-0").hasClass("is_active")?!1:"next"==t&&o.find(".gallery-item-"+l).hasClass("is_active")?!1:void m.stop().animate({opacity:0},d,function(){p.addClass("is_next").css({position:"absolute",display:"block",opacity:0}),r=o.find(".modaal-gallery-item.is_next").width(),c=o.find(".modaal-gallery-item.is_next").height(),o.find(".modaal-gallery-item-wrap").stop().animate({width:r,height:c},d,function(){m.removeClass(e.private_options.active_class+" "+e.options.gallery_active_class).removeAttr("style"),p.addClass(e.private_options.active_class+" "+e.options.gallery_active_class).removeClass("is_next").css("position",""),p.stop().animate({opacity:1},d,function(){a(this).removeAttr("style"),o.find(".modaal-gallery-item-wrap").removeAttr("style"),e.options.after_image_change.call(e,p)}),o.find(".modaal-gallery-item .modaal-gallery-label").removeAttr("tabindex"),o.find(".modaal-gallery-item."+e.private_options.active_class+" .modaal-gallery-label").attr("tabindex","0").focus(),o.find(".modaal-gallery-item."+e.private_options.active_class).is(".gallery-item-0")?n.stop().animate({opacity:0},150,function(){a(this).hide()}):n.stop().css({display:"block",opacity:n.css("opacity")}).animate({opacity:1},150),o.find(".modaal-gallery-item."+e.private_options.active_class).is(".gallery-item-"+l)?s.stop().animate({opacity:0},150,function(){a(this).hide()}):s.stop().css({display:"block",opacity:n.css("opacity")}).animate({opacity:1},150)})})},create_video:function(a){var t,e=this;t='<iframe src="'+a+'" class="modaal-video-frame" frameborder="0" allowfullscreen></iframe>',e.build_modal('<div class="modaal-video-container">'+t+"</div>")},create_iframe:function(a){var t,e=this;t=null!==e.options.width||void 0!==e.options.width||null!==e.options.height||void 0!==e.options.height?'<div class="modaal-content" aria-hidden="false" aria-labelledby="'+e.options.accessible_title+'" role="dialog"><iframe src="'+a+'" class="modaal-iframe-elem" style="width: '+e.options.width+"px;height: "+e.options.height+'px" frameborder="0" allowfullscreen></iframe></div>':'<div class="modaal-content-container">Please specify a width and height for your iframe</div>',e.build_modal(t)},modaal_open:function(){var t=this,e=a("#"+t.scope.id),o=t.options.animation;"none"===o&&(e.removeClass("modaal-start_none"),t.options.after_open.call(t,e)),"fade"===o&&e.removeClass("modaal-start_fade"),"slide-down"===o&&e.removeClass("modaal-start_slide_down");var i=e;a(".modaal-wrapper *[tabindex=0]").removeAttr("tabindex"),"image"==t.options.type?i=a("#"+t.scope.id).find(".modaal-gallery-item."+t.private_options.active_class):e.find(".modaal-iframe-elem").length?i=e.find(".modaal-iframe-elem"):e.find(".modaal-video-wrap").length?i=e.find(".modaal-video-wrap"):e.find(".modaal-content-container").length?i=e.find(".modaal-content-container"):e.find(".modaal-content").length&&(i=e.find(".modaal-content")),i.attr("tabindex","0").focus(),"none"!==o&&setTimeout(function(){t.options.after_open.call(t,e)},t.options.after_callback_delay)},modaal_close:function(){var t=this,e=a("#"+t.scope.id);t.options.before_close.call(t,e),null!==t.xhr&&(t.xhr.abort(),t.xhr=null),"none"===t.options.animation&&e.addClass("modaal-start_none"),"fade"===t.options.animation&&e.addClass("modaal-start_fade"),"slide-down"===t.options.animation&&e.addClass("modaal-start_slide_down"),setTimeout(function(){"inline"==t.options.type&&a("#"+t.scope.id+" .modaal-content-container").children().clone(!0,!0).appendTo(t.$elem.attr("href")),e.remove(),t.options.after_close.call(t),t.scope.is_open=!1},t.options.after_callback_delay),t.modaal_overlay("hide"),null!=t.lastFocus&&t.lastFocus.focus()},modaal_overlay:function(e){var o=this;"show"==e?(o.scope.is_open=!0,o.options.background_scroll||t.css({overflow:"hidden"}),t.append('<div class="modaal-overlay" id="'+o.scope.id+'_overlay"></div>'),a("#"+o.scope.id+"_overlay").css("background",o.options.background).stop().animate({opacity:o.options.overlay_opacity},o.options.animation_speed,function(){o.modaal_open()})):"hide"==e&&(t.css("overflow",""),a("#"+o.scope.id+"_overlay").stop().animate({opacity:0},o.options.animation_speed,function(){a(this).remove()}))}};a(function(){var t=a(".modaal");t.length&&t.each(function(){var t=a(this),e={},o=!1;t.attr("data-modaal-type")&&(o=!0,e.type=t.attr("data-modaal-type")),t.attr("data-modaal-animation")&&(o=!0,e.animation=t.attr("data-modaal-animation")),t.attr("data-modaal-animation-speed")&&(o=!0,e.animation_speed=t.attr("data-modaal-animation-speed")),t.attr("data-modaal-after-callback-delay")&&(o=!0,e.after_callback_delay=t.attr("data-modaal-after-callback-delay")),t.attr("data-modaal-locked")&&(o=!0,e.is_locked="true"===t.attr("data-modaal-locked")),t.attr("data-modaal-hide-close")&&(o=!0,e.hide_close="true"===t.attr("data-modaal-hide-close")),t.attr("data-modaal-background")&&(o=!0,e.background=t.attr("data-modaal-background")),t.attr("data-modaal-overlay-opacity")&&(o=!0,e.overlay_opacity=t.attr("data-modaal-overlay-opacity")),t.attr("data-modaal-overlay-close")&&(o=!0,e.overlay_close="false"!==t.attr("data-modaal-overlay-close")),t.attr("data-modaal-accessible-title")&&(o=!0,e.accessible_title=t.attr("data-modaal-accessible-title")),t.attr("data-modaal-start-open")&&(o=!0,e.start_open="true"===t.attr("data-modaal-start-open")),t.attr("data-modaal-fullscreen")&&(o=!0,e.fullscreen="true"===t.attr("data-modaal-fullscreen")),t.attr("data-modaal-custom-class")&&(o=!0,e.custom_class=t.attr("data-modaal-custom-class")),t.attr("data-modaal-background-scroll")&&(o=!0,e.background_scroll="true"===t.attr("data-modaal-background-scroll")),t.attr("data-modaal-width")&&(o=!0,e.width=parseInt(t.attr("data-modaal-width"))),t.attr("data-modaal-height")&&(o=!0,e.height=parseInt(t.attr("data-modaal-height"))),t.attr("data-modaal-confirm-button-text")&&(o=!0,e.confirm_button_text=t.attr("data-modaal-confirm-button-text")),t.attr("data-modaal-confirm-cancel-button-text")&&(o=!0,e.confirm_cancel_button_text=t.attr("data-modaal-confirm-cancel-button-text")),t.attr("data-modaal-confirm-title")&&(o=!0,e.confirm_title=t.attr("data-modaal-confirm-title")),t.attr("data-modaal-confirm-content")&&(o=!0,e.confirm_content=t.attr("data-modaal-confirm-content")),t.attr("data-modaal-gallery-active-class")&&(o=!0,e.gallery_active_class=t.attr("data-modaal-gallery-active-class")),t.attr("data-modaal-loading-content")&&(o=!0,e.loading_content=t.attr("data-modaal-loading-content")),t.attr("data-modaal-loading-class")&&(o=!0,e.loading_class=t.attr("data-modaal-loading-class")),t.attr("data-modaal-ajax-error-class")&&(o=!0,e.ajax_error_class=t.attr("data-modaal-ajax-error-class")),t.attr("data-modaal-instagram-id")&&(o=!0,e.instagram_id=t.attr("data-modaal-instagram-id")),o&&t.modaal(e)})}),a.fn.modaal=function(t){return this.each(function(){var e=a(this).data("modaal");if(e){if("string"==typeof t)switch(t){case"close":e.modaal_close()}}else{var o=Object.create(i);o.init(t,this),a.data(this,"modaal",o)}})},a.fn.modaal.options={type:"inline",animation:"fade",animation_speed:300,after_callback_delay:350,is_locked:!1,hide_close:!1,background:"#000",overlay_opacity:"0.8",overlay_close:!0,accessible_title:"Dialog Window",start_open:!1,fullscreen:!1,custom_class:"",background_scroll:!1,width:null,height:null,before_open:function(){},after_open:function(){},before_close:function(){},after_close:function(){},source:function(a,t){return t},confirm_button_text:"Confirm",confirm_cancel_button_text:"Cancel",confirm_title:"Confirm Title",confirm_content:"<p>This is the default confirm dialog content. Replace me through the options</p>",confirm_callback:function(){},gallery_active_class:"gallery_active_item",before_image_change:function(a,t){},after_image_change:function(a){},loading_content:o,loading_class:"is_loading",ajax_error_class:"modaal-error",ajax_success:function(){},instagram_id:null}}(jQuery,window,document);
var _self="undefined"!=typeof window?window:"undefined"!=typeof WorkerGlobalScope&&self instanceof WorkerGlobalScope?self:{},Prism=function(){var e=/\blang(?:uage)?-(\w+)\b/i,t=0,a=_self.Prism={util:{encode:function(e){return e instanceof n?new n(e.type,a.util.encode(e.content),e.alias):"Array"===a.util.type(e)?e.map(a.util.encode):e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\u00a0/g," ")},type:function(e){return Object.prototype.toString.call(e).match(/\[object (\w+)\]/)[1]},objId:function(e){return e.__id||Object.defineProperty(e,"__id",{value:++t}),e.__id},clone:function(e){var t=a.util.type(e);switch(t){case"Object":var n={};for(var r in e)e.hasOwnProperty(r)&&(n[r]=a.util.clone(e[r]));return n;case"Array":return e.map&&e.map(function(e){return a.util.clone(e)})}return e}},languages:{extend:function(e,t){var n=a.util.clone(a.languages[e]);for(var r in t)n[r]=t[r];return n},insertBefore:function(e,t,n,r){r=r||a.languages;var i=r[e];if(2==arguments.length){n=arguments[1];for(var s in n)n.hasOwnProperty(s)&&(i[s]=n[s]);return i}var l={};for(var o in i)if(i.hasOwnProperty(o)){if(o==t)for(var s in n)n.hasOwnProperty(s)&&(l[s]=n[s]);l[o]=i[o]}return a.languages.DFS(a.languages,function(t,a){a===r[e]&&t!=e&&(this[t]=l)}),r[e]=l},DFS:function(e,t,n,r){r=r||{};for(var i in e)e.hasOwnProperty(i)&&(t.call(e,i,e[i],n||i),"Object"!==a.util.type(e[i])||r[a.util.objId(e[i])]?"Array"!==a.util.type(e[i])||r[a.util.objId(e[i])]||(r[a.util.objId(e[i])]=!0,a.languages.DFS(e[i],t,i,r)):(r[a.util.objId(e[i])]=!0,a.languages.DFS(e[i],t,null,r)))}},plugins:{},highlightAll:function(e,t){var n={callback:t,selector:'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'};a.hooks.run("before-highlightall",n);for(var r,i=n.elements||document.querySelectorAll(n.selector),s=0;r=i[s++];)a.highlightElement(r,e===!0,n.callback)},highlightElement:function(t,n,r){for(var i,s,l=t;l&&!e.test(l.className);)l=l.parentNode;l&&(i=(l.className.match(e)||[,""])[1],s=a.languages[i]),t.className=t.className.replace(e,"").replace(/\s+/g," ")+" language-"+i,l=t.parentNode,/pre/i.test(l.nodeName)&&(l.className=l.className.replace(e,"").replace(/\s+/g," ")+" language-"+i);var o=t.textContent,u={element:t,language:i,grammar:s,code:o};if(a.hooks.run("before-sanity-check",u),!u.code||!u.grammar)return void a.hooks.run("complete",u);if(a.hooks.run("before-highlight",u),n&&_self.Worker){var g=new Worker(a.filename);g.onmessage=function(e){u.highlightedCode=e.data,a.hooks.run("before-insert",u),u.element.innerHTML=u.highlightedCode,r&&r.call(u.element),a.hooks.run("after-highlight",u),a.hooks.run("complete",u)},g.postMessage(JSON.stringify({language:u.language,code:u.code,immediateClose:!0}))}else u.highlightedCode=a.highlight(u.code,u.grammar,u.language),a.hooks.run("before-insert",u),u.element.innerHTML=u.highlightedCode,r&&r.call(t),a.hooks.run("after-highlight",u),a.hooks.run("complete",u)},highlight:function(e,t,r){var i=a.tokenize(e,t);return n.stringify(a.util.encode(i),r)},tokenize:function(e,t){var n=a.Token,r=[e],i=t.rest;if(i){for(var s in i)t[s]=i[s];delete t.rest}e:for(var s in t)if(t.hasOwnProperty(s)&&t[s]){var l=t[s];l="Array"===a.util.type(l)?l:[l];for(var o=0;o<l.length;++o){var u=l[o],g=u.inside,c=!!u.lookbehind,p=!!u.greedy,d=0,m=u.alias;u=u.pattern||u;for(var f=0;f<r.length;f++){var h=r[f];if(r.length>e.length)break e;if(!(h instanceof n)){u.lastIndex=0;var y=u.exec(h),v=1;if(!y&&p&&f!=r.length-1){var b=r[f+1].matchedStr||r[f+1],k=h+b;if(f<r.length-2&&(k+=r[f+2].matchedStr||r[f+2]),u.lastIndex=0,y=u.exec(k),!y)continue;var w=y.index+(c?y[1].length:0);if(w>=h.length)continue;var P=y.index+y[0].length,x=h.length+b.length;if(v=3,x>=P){if(r[f+1].greedy)continue;v=2,k=k.slice(0,x)}h=k}if(y){c&&(d=y[1].length);var w=y.index+d,y=y[0].slice(d),P=w+y.length,_=h.slice(0,w),j=h.slice(P),A=[f,v];_&&A.push(_);var W=new n(s,g?a.tokenize(y,g):y,m,y,p);A.push(W),j&&A.push(j),Array.prototype.splice.apply(r,A)}}}}}return r},hooks:{all:{},add:function(e,t){var n=a.hooks.all;n[e]=n[e]||[],n[e].push(t)},run:function(e,t){var n=a.hooks.all[e];if(n&&n.length)for(var r,i=0;r=n[i++];)r(t)}}},n=a.Token=function(e,t,a,n,r){this.type=e,this.content=t,this.alias=a,this.matchedStr=n||null,this.greedy=!!r};if(n.stringify=function(e,t,r){if("string"==typeof e)return e;if("Array"===a.util.type(e))return e.map(function(a){return n.stringify(a,t,e)}).join("");var i={type:e.type,content:n.stringify(e.content,t,r),tag:"span",classes:["token",e.type],attributes:{},language:t,parent:r};if("comment"==i.type&&(i.attributes.spellcheck="true"),e.alias){var s="Array"===a.util.type(e.alias)?e.alias:[e.alias];Array.prototype.push.apply(i.classes,s)}a.hooks.run("wrap",i);var l="";for(var o in i.attributes)l+=(l?" ":"")+o+'="'+(i.attributes[o]||"")+'"';return"<"+i.tag+' class="'+i.classes.join(" ")+'" '+l+">"+i.content+"</"+i.tag+">"},!_self.document)return _self.addEventListener?(_self.addEventListener("message",function(e){var t=JSON.parse(e.data),n=t.language,r=t.code,i=t.immediateClose;_self.postMessage(a.highlight(r,a.languages[n],n)),i&&_self.close()},!1),_self.Prism):_self.Prism;var r=document.currentScript||[].slice.call(document.getElementsByTagName("script")).pop();return r&&(a.filename=r.src,document.addEventListener&&!r.hasAttribute("data-manual")&&document.addEventListener("DOMContentLoaded",a.highlightAll)),_self.Prism}();"undefined"!=typeof module&&module.exports&&(module.exports=Prism),"undefined"!=typeof global&&(global.Prism=Prism),Prism.languages.markup={comment:/<!--[\w\W]*?-->/,prolog:/<\?[\w\W]+?\?>/,doctype:/<!DOCTYPE[\w\W]+?>/,cdata:/<!\[CDATA\[[\w\W]*?]]>/i,tag:{pattern:/<\/?(?!\d)[^\s>\/=.$<]+(?:\s+[^\s>\/=]+(?:=(?:("|')(?:\\\1|\\?(?!\1)[\w\W])*\1|[^\s'">=]+))?)*\s*\/?>/i,inside:{tag:{pattern:/^<\/?[^\s>\/]+/i,inside:{punctuation:/^<\/?/,namespace:/^[^\s>\/:]+:/}},"attr-value":{pattern:/=(?:('|")[\w\W]*?(\1)|[^\s>]+)/i,inside:{punctuation:/[=>"']/}},punctuation:/\/?>/,"attr-name":{pattern:/[^\s>\/]+/,inside:{namespace:/^[^\s>\/:]+:/}}}},entity:/&#?[\da-z]{1,8};/i},Prism.hooks.add("wrap",function(e){"entity"===e.type&&(e.attributes.title=e.content.replace(/&amp;/,"&"))}),Prism.languages.xml=Prism.languages.markup,Prism.languages.html=Prism.languages.markup,Prism.languages.mathml=Prism.languages.markup,Prism.languages.svg=Prism.languages.markup,Prism.languages.css={comment:/\/\*[\w\W]*?\*\//,atrule:{pattern:/@[\w-]+?.*?(;|(?=\s*\{))/i,inside:{rule:/@[\w-]+/}},url:/url\((?:(["'])(\\(?:\r\n|[\w\W])|(?!\1)[^\\\r\n])*\1|.*?)\)/i,selector:/[^\{\}\s][^\{\};]*?(?=\s*\{)/,string:/("|')(\\(?:\r\n|[\w\W])|(?!\1)[^\\\r\n])*\1/,property:/(\b|\B)[\w-]+(?=\s*:)/i,important:/\B!important\b/i,"function":/[-a-z0-9]+(?=\()/i,punctuation:/[(){};:]/},Prism.languages.css.atrule.inside.rest=Prism.util.clone(Prism.languages.css),Prism.languages.markup&&(Prism.languages.insertBefore("markup","tag",{style:{pattern:/(<style[\w\W]*?>)[\w\W]*?(?=<\/style>)/i,lookbehind:!0,inside:Prism.languages.css,alias:"language-css"}}),Prism.languages.insertBefore("inside","attr-value",{"style-attr":{pattern:/\s*style=("|').*?\1/i,inside:{"attr-name":{pattern:/^\s*style/i,inside:Prism.languages.markup.tag.inside},punctuation:/^\s*=\s*['"]|['"]\s*$/,"attr-value":{pattern:/.+/i,inside:Prism.languages.css}},alias:"language-css"}},Prism.languages.markup.tag)),Prism.languages.clike={comment:[{pattern:/(^|[^\\])\/\*[\w\W]*?\*\//,lookbehind:!0},{pattern:/(^|[^\\:])\/\/.*/,lookbehind:!0}],string:{pattern:/(["'])(\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,greedy:!0},"class-name":{pattern:/((?:\b(?:class|interface|extends|implements|trait|instanceof|new)\s+)|(?:catch\s+\())[a-z0-9_\.\\]+/i,lookbehind:!0,inside:{punctuation:/(\.|\\)/}},keyword:/\b(if|else|while|do|for|return|in|instanceof|function|new|try|throw|catch|finally|null|break|continue)\b/,"boolean":/\b(true|false)\b/,"function":/[a-z0-9_]+(?=\()/i,number:/\b-?(?:0x[\da-f]+|\d*\.?\d+(?:e[+-]?\d+)?)\b/i,operator:/--?|\+\+?|!=?=?|<=?|>=?|==?=?|&&?|\|\|?|\?|\*|\/|~|\^|%/,punctuation:/[{}[\];(),.:]/},Prism.languages.javascript=Prism.languages.extend("clike",{keyword:/\b(as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|var|void|while|with|yield)\b/,number:/\b-?(0x[\dA-Fa-f]+|0b[01]+|0o[0-7]+|\d*\.?\d+([Ee][+-]?\d+)?|NaN|Infinity)\b/,"function":/[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*(?=\()/i}),Prism.languages.insertBefore("javascript","keyword",{regex:{pattern:/(^|[^\/])\/(?!\/)(\[.+?]|\\.|[^\/\\\r\n])+\/[gimyu]{0,5}(?=\s*($|[\r\n,.;})]))/,lookbehind:!0,greedy:!0}}),Prism.languages.insertBefore("javascript","class-name",{"template-string":{pattern:/`(?:\\\\|\\?[^\\])*?`/,greedy:!0,inside:{interpolation:{pattern:/\$\{[^}]+\}/,inside:{"interpolation-punctuation":{pattern:/^\$\{|\}$/,alias:"punctuation"},rest:Prism.languages.javascript}},string:/[\s\S]+/}}}),Prism.languages.markup&&Prism.languages.insertBefore("markup","tag",{script:{pattern:/(<script[\w\W]*?>)[\w\W]*?(?=<\/script>)/i,lookbehind:!0,inside:Prism.languages.javascript,alias:"language-javascript"}}),Prism.languages.js=Prism.languages.javascript,!function(){"undefined"!=typeof self&&!self.Prism||"undefined"!=typeof global&&!global.Prism||Prism.hooks.add("wrap",function(e){"keyword"===e.type&&e.classes.push("keyword-"+e.content)})}();
//# sourceMappingURL=../maps/js/main-0472cb6b4a.js.map