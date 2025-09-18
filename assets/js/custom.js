(function($) {
  // Outline Menu Functionality
  var outlineToggle = document.getElementById("outline-toggle");
  var outlineSidebar = document.getElementById("outline-sidebar");
  var outlineClose = document.getElementById("outline-close");
  
  // Toggle outline sidebar
  outlineToggle.addEventListener("click", function(e) {
    e.preventDefault();
    if (outlineSidebar.classList.contains("open")) {
      outlineSidebar.classList.remove("open");
      // Remove overlay when sidebar is closed
      if ($('.outline-overlay').length > 0) {
        $('.outline-overlay').remove();
      }
    } else {
      outlineSidebar.classList.add("open");
      // Add overlay when sidebar is open
      if ($('.outline-overlay').length === 0) {
        $('body').append('<div class="outline-overlay"></div>');
        $('.outline-overlay').on('click', function() {
          outlineSidebar.classList.remove('open');
          $(this).remove();
        });
      }
    }
  });
  
  // Close outline sidebar
  outlineClose.addEventListener("click", function(e) {
    e.preventDefault();
    outlineSidebar.classList.remove("open");
    // Remove overlay when sidebar is closed
    if ($('.outline-overlay').length > 0) {
      $('.outline-overlay').remove();
    }
  });
  
  // Close sidebar after clicking on menu items
  // and smooth scroll to the section
  $('.outline-menu a').on('click', function(e) {
    e.preventDefault();
    
    // Close the sidebar
    outlineSidebar.classList.remove('open');
    if ($('.outline-overlay').length > 0) {
      $('.outline-overlay').remove();
    }
    
    // Smooth scroll to the target section
    var targetId = $(this).attr('href').substring(1); // 移除#前缀
    var targetSection = $('section[data-section="' + targetId + '"]');
    
    if (targetSection.length) {
      $('html, body').animate({
        scrollTop: targetSection.offset().top - 50
      }, 800);
    }
  });
  
  // 样式已移至CSS文件中

  $(".owl-carousel").owlCarousel({
    items: 4,
    lazyLoad: true,
    loop: true,
    dots: true,
    margin: 30,
    responsiveClass: true,
    responsive: {
      0: {
        items: 1
      },
      600: {
        items: 1
      },
      1000: {
        items: 1
      }
    }
  });

  $(".hover").mouseleave(function() {
    $(this).removeClass("hover");
  });

  $(".isotope-wrapper").each(function() {
    var $isotope = $(".isotope-box", this);
    var $filterCheckboxes = $('input[type="radio"]', this);

    var filter = function() {
      var type = $filterCheckboxes.filter(":checked").data("type") || "*";
      if (type !== "*") {
        type = '[data-type="' + type + '"]';
      }
      $isotope.isotope({ filter: type });
    };

    $isotope.isotope({
      itemSelector: ".isotope-item",
      layoutMode: "masonry"
    });

    $(this).on("change", filter);
    filter();
  });

  lightbox.option({
    resizeDuration: 200,
    wrapAround: true
  });
})(jQuery);
