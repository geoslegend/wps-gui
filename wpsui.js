if (!window.wps) {
  window.wps = {};
}
var wps = window.wps;

wps.client = function(options) {
  this.url_ = options.url;
  this.format_ = new OpenLayers.Format.WPSCapabilities();
  this.client_ = new OpenLayers.WPSClient({
    servers: {
      'wpsgui': this.url_
    }
  });
};

wps.client.prototype.getGroupedProcesses = function(callback) {
  var format = this.format_;
  $.ajax(this.url_ + '?service=WPS&request=GetCapabilities&version=1.0.0').
    then(function(response) {
      var info = format.read(response);
      var groups = {};
      for (var key in info.processOfferings) {
        var names = key.split(':');
        var group = names[0];
        if (!groups[group]) {
          groups[group] = [];
        }
        groups[group].push(names[1]);
      }
      callback.call(this, groups, info);
    });
};

wps.ui = function(options) {
  this.parentContainer_ = options.parentContainer;
  this.sideBar_ = options.sideBar;
  this.dropZone_ = options.dropZone;
  this.client_ = options.client;
  this.spaceWidth = options.spaceWidth || 5000;
  this.spaceHeight = options.spaceHeight || 5000;
  this.scaleFactor = options.scaleFactor || 1;
  this.nodeWidth = options.nodeWidth || 70;
  this.nodeHeight = options.nodeHeight || 30;
  this.lineCurveScale = options.lineCurveScale || 0.75;
  this.nodes = [];
  this.clickElapsed = 0;
  this.clickTime = 0;
  this.movingSet = [];
  this.mouseOffset = [0,0];
  this.mouseMode = 0;
  this.mousePosition = null;
  this.selectedLink = null;
  this.mousedownNode = null;
  this.createSearch();
  this.createCanvas();
  this.createDropTarget();
  this.createZoomToolbar();
};

wps.ui.prototype.zoomIn = function(evt) {
  var me = evt.data;
  if (me.scaleFactor < 2) {
    me.scaleFactor += 0.1;
    me.redraw();
  }
};

wps.ui.prototype.zoomOut = function(evt) {
  var me = evt.data;
  if (me.scaleFactor > 0.3) {
    me.scaleFactor -= 0.1;
    me.redraw();
  }
};

wps.ui.prototype.resetZoom = function(evt) {
  var me = evt.data;
  me.scaleFactor = 1;
  me.redraw();
};

wps.ui.prototype.createZoomToolbar = function() {
  $('#btn-zoom-out').click(this, this.zoomOut);
  $('#btn-zoom-zero').click(this, this.resetZoom);
  $('#btn-zoom-in').click(this, this.zoomIn);
};

wps.ui.prototype.canvasMouseMove = function(ui) {
  var me = ui;
  me.mousePosition = d3.touches(this)[0]||d3.mouse(this);
  // MOVING
  if (me.mouseMode == 1) {
    var m = me.mousePosition;
    var d = (me.mouseOffset[0]-m[0])*(me.mouseOffset[0]-m[0]) + (me.mouseOffset[1]-m[1])*(me.mouseOffset[1]-m[1]);
    if (d > 2) {
      // MOVING_ACTIVE
      me.mouseMode = 3;
      me.clickElapsed = 0;
    }
  } else if (me.mouseMode == 3) {
    var mousePos = me.mousePosition;
    var minX = 0;
    var minY = 0;
    var n, node;
    for (n = 0; n<me.movingSet.length; n++) {
      node = me.movingSet[n];
      node.n.x = mousePos[0]+node.dx;
      node.n.y = mousePos[1]+node.dy;
      node.n.dirty = true;
      minX = Math.min(node.n.x-node.n.w/2-5,minX);
      minY = Math.min(node.n.y-node.n.h/2-5,minY);
    }
    if (minX !== 0 || minY !== 0) {
      for (n = 0; n<me.movingSet.length; n++) {
        node = me.movingSet[n];
        node.n.x -= minX;
        node.n.y -= minY;
      }
    }
  }
  me.redraw();
};

wps.ui.prototype.canvasMouseUp = function(ui) {
  var me = ui;
  if (me.mouseMode == 3) {
    for (var i=0;i<me.movingSet.length;i++) {
      delete me.movingSet[i].ox;
      delete me.movingSet[i].oy;
    }
  }
  me.redraw();
  me.resetMouseVars();
};

wps.ui.prototype.canvasMouseDown = function(ui) {
  var me = ui;
  if (!me.mousedownNode && !me.mousedownLink) {
    me.selectedLink = null;
    me.updateSelection();
  }
};

wps.ui.prototype.resetMouseVars = function() {
  this.mousedownNode = null;
  this.mouseupNode = null;
  this.mousedownLink = null;
  this.mouseMode = 0;
  this.mousedownPortType = 0;
};

wps.ui.prototype.createCanvas = function() {
  this.outer = d3.select("#chart").
    append("svg:svg").
    attr("width", this.spaceWidth).
    attr("height", this.spaceHeight).
    attr("pointer-events", "all").
    style("cursor","crosshair");
  this.vis = this.outer.
    append('svg:g').
    on("dblclick.zoom", null).
    append('svg:g').
    on("mousedown", $.proxy(this.canvasMouseDown, null, this)).
    on("mouseup", $.proxy(this.canvasMouseUp, null, this)).
    on("mousemove", $.proxy(this.canvasMouseMove, null, this));
  var outer_background = this.vis.append('svg:rect').
    attr('width', this.spaceWidth).
    attr('height', this.spaceHeight).
    attr('fill','#fff');
};

wps.ui.prototype.createDropTarget = function() {
  var me = this;
  this.dropZone_.droppable({
    accept:".palette_node",
    drop: function( event, ui ) {
      d3.event = event;
      var selected_tool = $(ui.draggable[0]).data('type');
      var process = me.client_.client_.getProcess('wpsgui', selected_tool, {callback: function(info) { 
        var mousePos = d3.touches(this)[0]||d3.mouse(this);
        mousePos[1] += this.scrollTop;
        mousePos[0] += this.scrollLeft;
        mousePos[1] /= me.scaleFactor;
        mousePos[0] /= me.scaleFactor;
        /* TODO no workspaces as yet, so z is 0 */
        var nn = { id:(1+Math.random()*4294967295).toString(16),x: mousePos[0],y:mousePos[1],w:this.nodeWidth,z:0};
        nn.type = selected_tool;
        nn.inputs = info.dataInputs.length;
        nn.outputs = info.processOutputs.length;
        // TODO make dynamic
        nn._def = {
          category: "process",
          color: "rgb(231, 231, 74)",
          label: selected_tool
        };
        var link, i, ii, delta = 50, span = delta * info.dataInputs.length, deltaY = (span-delta)/2;
        for (i=0, ii=info.dataInputs.length; i<ii; ++i) {
          var input = { id:(1+Math.random()*4294967295).toString(16),x: mousePos[0]-200,y:mousePos[1]+deltaY,w:this.nodeWidth,z:0};
          deltaY -= delta;
          input.type = info.dataInputs[i].title;
          input.outputs = 1;
          input._def = {
            category: "input",
            color: "rgb(255, 0, 0)",
            label: input.type
          };
          me.nodes.push(input);
          // create a link as well between input and process
          link = {
            source: input,
            target: nn
          };
          me.nodes.push(link);
        }
        for (i=0, ii=info.processOutputs.length; i<ii; ++i) {
          var output = { id:(1+Math.random()*4294967295).toString(16),x: mousePos[0]+200,y:mousePos[1],w:this.nodeWidth,z:0};
          output.type = info.processOutputs[i].title;
          output.inputs = 1;
          output._def = { 
            category: "output",
            color: "rgb(0, 255, 0)",
            label: output.type
          };
          me.nodes.push(output);
          // create a link as well between process and output
          link = {
            source: nn,
            target: output
          };
          me.nodes.push(link);
        }
        me.nodes.push(nn);
        me.redraw();
      }, scope: this});
    }
  });
};

wps.ui.prototype.createLinkPaths = function() {
  var me = this;
  var link = this.vis.selectAll(".link").data(this.nodes);
  var linkEnter = link.enter().insert("g",".node").attr("class","link");
  linkEnter.each(function(d,i) {
    var l = d3.select(this);
    l.append("svg:path").attr("class","link_background link_path");
    l.append("svg:path").attr("class","link_outline link_path");
    l.append("svg:path").attr("class","link_line link_path");
  });
  link.exit().remove();
  var links = this.vis.selectAll(".link_path")
  links.attr("d",function(d) {
    if (!d.source || !d.target) return;
    var numOutputs = d.source.outputs || 1;
    var sourcePort = d.sourcePort || 0;
    var y = -((numOutputs-1)/2)*13 +13*sourcePort;
    var dy = d.target.y-(d.source.y+y);
    var dx = (d.target.x-d.target.w/2)-(d.source.x+d.source.w/2);
    var delta = Math.sqrt(dy*dy+dx*dx);
    var scale = me.lineCurveScale;
    var scaleY = 0;
    if (delta < me.nodeWidth) {
      scale = 0.75-0.75*((me.nodeWidth-delta)/me.nodeWidth);
    }
    if (dx < 0) {
      scale += 2*(Math.min(5*me.nodeWidth,Math.abs(dx))/(5*me.nodeWidth));
      if (Math.abs(dy) < 3*me.nodeHeight) {
        scaleY = ((dy>0)?0.5:-0.5)*(((3*me.nodeHeight)-Math.abs(dy))/(3*me.nodeHeight))*(Math.min(me.nodeWidth,Math.abs(dx))/(me.nodeWidth)) ;
      }
    }
    d.x1 = d.source.x+d.source.w/2;
    d.y1 = d.source.y+y;
    d.x2 = d.target.x-d.target.w/2;
    d.y2 = d.target.y;
    return "M "+(d.source.x+d.source.w/2)+" "+(d.source.y+y)+
      " C "+(d.source.x+d.source.w/2+scale*me.nodeWidth)+" "+(d.source.y+y+scaleY*me.nodeHeight)+" "+
      (d.target.x-d.target.w/2-scale*me.nodeWidth)+" "+(d.target.y-scaleY*me.nodeHeight)+" "+
      (d.target.x-d.target.w/2)+" "+d.target.y;
  });
};

wps.ui.prototype.redraw = function() {
  this.vis.attr("transform","scale(" + this.scaleFactor + ")");
  this.outer.attr("width", this.spaceWidth*this.scaleFactor).attr("height", this.spaceHeight*this.scaleFactor);
  var node = this.vis.selectAll(".nodegroup").data(this.nodes, function(d){ return d.id; });
  node.exit().remove();
  var nodeEnter = node.enter().insert("svg:g").attr("class", "node nodegroup");
  var me = this;
  nodeEnter.each(function(d,i) {
    if (d._def) {
      var node = d3.select(this);
      node.attr("id",d.id);
      var l = d._def.label;
      l = (typeof l === "function" ? l.call(d) : l)||"";
      d.w = Math.max(me.nodeWidth,me.calculateTextWidth(l)+(d.inputs>0?7:0) );
      d.h = Math.max(me.nodeHeight,(d.outputs||0) * 15);
      me.createProcessRect(node);
      var text = me.createProcessText(node, d);
      me.createInputLink(node, d, text);
    }
  });
  node.each(function(d,i) {
    me.updateNode.call(this, d);
  });
  this.createLinkPaths();
};

wps.ui.prototype.createInputLink = function(node, d, text) {
  if (d.inputs > 0) {
    text.attr("x",8);
    node.append("rect").attr("class","port port_input").attr("rx",3).attr("ry",3).attr("x",-5).attr("width",10).attr("height",10).
      attr("y", 10);
  }
};

wps.ui.prototype.calculateTextWidth = function(str) {
  var sp = document.createElement("span");
  sp.className = "node_label";
  sp.style.position = "absolute";
  sp.style.top = "-1000px";
  sp.innerHTML = (str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  document.body.appendChild(sp);
  var w = sp.offsetWidth;
  document.body.removeChild(sp);
  return 20+w;
};

wps.ui.prototype.updateNode = function(d) {
  // TODO decide when dirty
  d.dirty = true;
  // TODO check in what cases d.w or d.h are undefined
  if (d.dirty && d.w && d.h) {
    var thisNode = d3.select(this);
    thisNode.attr("transform", function(d) { return "translate(" + (d.x-d.w/2) + "," + (d.y-d.h/2) + ")"; });
    thisNode.selectAll(".node").
      attr("width",function(d){return d.w;}).
      attr("height",function(d){return d.h;}).
      classed("node_selected",function(d) { return d.selected; }).
      classed("node_highlighted",function(d) { return d.highlighted; });
      thisNode.selectAll('text.node_label').text(function(d,i){
        return d._def.label || "";
      }).
        attr('y', function(d){return (d.h/2)-1;}).
        attr('class',function(d){
          return 'node_label'+
            (d._def.align?' node_label_'+d._def.align:'')+
            (d._def.label?' '+(typeof d._def.labelStyle == "function" ? d._def.labelStyle.call(d):d._def.labelStyle):'');
        });
      var numOutputs = d.outputs;
      var y = (d.h/2)-((numOutputs-1)/2)*13;
      d.ports = d.ports || d3.range(numOutputs);
      d._ports = thisNode.selectAll(".port_output").data(d.ports);
      d._ports.enter().append("rect").attr("class","port port_output").attr("rx",3).attr("ry",3).attr("width",10).attr("height",10);
      d._ports.exit().remove();
      if (d._ports) {
        var numOutputs = d.outputs || 1;
        var y = (d.h/2)-((numOutputs-1)/2)*13;
        var x = d.w - 5;
        d._ports.each(function(d,i) {
          var port = d3.select(this);
          port.attr("y",(y+13*i)-5).attr("x",x);
        });
      }
      d.dirty = false;
    }
};

wps.ui.prototype.clearSelection = function() {
  for (var i in this.movingSet) {
    var n = this.movingSet[i];
    n.n.dirty = true;
    n.n.selected = false;
  }
  this.movingSet = [];
  this.selectedLink = null;
};

wps.ui.prototype.nodeMouseUp = function(ui, d) {
  var me = ui;
  if (me.mousedownNode == d && me.clickElapsed > 0 && me.clickElapsed < 750) {
    me.clickElapsed = 0;
    d3.event.stopPropagation();
    return;
  }
};

wps.ui.prototype.updateSelection = function() {
  // TODO?
};

wps.ui.prototype.nodeMouseDown = function(ui, d) {
  var me = ui;
  me.mousedownNode = d;
  var now = Date.now();
  me.clickElapsed = now-me.clickTime;
  me.clickTime = now;
  if (!d.selected) {
    me.clearSelection();
  }
  me.mousedownNode.selected = true;
  me.movingSet.push({n:me.mousedownNode});
  me.selectedLink = null;
  if (d3.event.button != 2) {
    // MOVING
    me.mouseMode = 1;
    var mouse = d3.touches(this)[0]||d3.mouse(this);
    mouse[0] += d.x-d.w/2;
    mouse[1] += d.y-d.h/2;
    for (var i in me.movingSet) {
      me.movingSet[i].ox = me.movingSet[i].n.x;
      me.movingSet[i].oy = me.movingSet[i].n.y;
      me.movingSet[i].dx = me.movingSet[i].n.x-mouse[0];
      me.movingSet[i].dy = me.movingSet[i].n.y-mouse[1];
    }
    me.mouseOffset = d3.mouse(document.body);
    if (isNaN(me.mouseOffset[0])) {
      me.mouseOffset = d3.touches(document.body)[0];
    }
  }
  d.dirty = true;
  me.updateSelection();
  me.redraw();
  d3.event.stopPropagation();
};

wps.ui.prototype.createProcessRect = function(node) {
  var mainRect = node.append("rect").
    attr("class", "node").
    classed("node_unknown",function(d) { return d.type == "unknown"; }).
    attr("rx", 6).
    attr("ry", 6).
    attr("fill",function(d) { return d._def.color;}).
    on("mouseup", $.proxy(this.nodeMouseUp, null, this)).
    on("mousedown", $.proxy(this.nodeMouseDown, null, this));
};

wps.ui.prototype.createProcessText = function(node, d) {
  var text = node.append('svg:text').attr('class','node_label').attr('x', 8).attr('dy', '.35em').attr('text-anchor','start');
  if (d._def.align) {
    text.attr('class','node_label node_label_'+d._def.align);
    text.attr('text-anchor','end');
  }
  return text;
};

wps.ui.prototype.createSearch = function() {
  var filterChange = function() {
    var val = $("#palette-search-input").val();
    if (val === "") {
      $("#palette-search-clear").hide();
    } else {
      $("#palette-search-clear").show();
    }
    var re = new RegExp(val, 'i');
    $(".palette_node").each(function(i,el) {
      if (val === "" || re.test(el.innerHTML)) {
        $(this).show();
      } else {
        $(this).hide();
      }
    });
  };
  $("#palette-search-clear").on("click",function(e) {
    e.preventDefault();
    $("#palette-search-input").val("");
    filterChange();
    $("#palette-search-input").focus();
  });
  $("#palette-search-input").val("");
  $("#palette-search-input").on("keyup",function() {
    filterChange();
  });
  $("#palette-search-input").on("focus",function() {
    $("body").one("mousedown",function() {
      $("#palette-search-input").blur();
    });
  });
};

wps.ui.prototype.createProcessCategory = function(group) {
  var category = $('<div class="palette-category"><div class="palette-header">' +
    '<i class="glyphicon glyphicon-chevron-down expanded"></i><span>' +
    group + '</span></div></div>');
  this.parentContainer_.append(category);
  var content = $('<div class="palette-content"></div>');
  $(category).append(content);
  $(category).children('.palette-header').click(function(e) {
    $(this).next().slideToggle();
    $(this).children("i").toggleClass("expanded");
  });
  return content;
};

wps.ui.prototype.createProcess = function(offering) {
  var summary = offering['abstract'];
  var title = offering.title;
  var id = offering.identifier;
  var d = $('<div class="palette_node ui-draggable">' + id.split(':')[1] + '</div>');
  $(d).data('type', id);
  $(d).popover({
    title: title,
    placement:"right",
    trigger: "hover",
    delay: { show: 750, hide: 50 },
    html: true,
    container:'body',
    content: summary
  });
  var sidebar = this.sideBar_;
  $(d).click(summary, function(evt) {
    var help = '<div class="node-help">' + evt.data + "</div>";
    sidebar.html(help);
  });
  $(d).draggable({
    helper: 'clone',
    appendTo: 'body',
    revert: true,
    revertDuration: 50
  });
  return d;
};

