const { Component, createFactory, createElement } = React;
const dom = ReactDOMFactories;

const AUTO_EXPAND_DEPTH = 0;

class ArrowExpander extends Component {
  static get propTypes() {
    return {
      expanded: PropTypes.bool,
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    return this.props.expanded !== nextProps.expanded;
  }

  render() {
    const {
      expanded,
    } = this.props;

    const classNames = ["arrow"];
    if (expanded) {
      classNames.push("expanded");
    }
    var svg = {
        __html: '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 13.4c-.5 0-.9-.2-1.2-.6L.4 5.2C0 4.7-.1 4.3.2 3.7S1 3 1.6 3h12.8c.6 0 1.2.1 1.4.7.3.6.2 1.1-.2 1.6l-6.4 7.6c-.3.4-.7.5-1.2.5z"/></svg>'
    };
    return createElement('span', {
        className: classNames.join(" "),
        dangerouslySetInnerHTML: svg
    });
  }
}

const treeIndent = dom.span({className: "tree-indent"}, "\u200B");

class TreeNode extends Component {
  static get propTypes() {
    return {
      id: PropTypes.any.isRequired,
      index: PropTypes.number.isRequired,
      depth: PropTypes.number.isRequired,
      focused: PropTypes.bool.isRequired,
      expanded: PropTypes.bool.isRequired,
      item: PropTypes.any.isRequired,
      isExpandable: PropTypes.bool.isRequired,
      onClick: PropTypes.func,
      renderItem: PropTypes.func.isRequired,
    };
  }

  shouldComponentUpdate(nextProps) {
    return this.props.item !== nextProps.item ||
      this.props.focused !== nextProps.focused ||
      this.props.expanded !== nextProps.expanded;
  }

  render() {
    const {
      depth,
      id,
      item,
      focused,
      expanded,
      renderItem,
      isExpandable,
    } = this.props;

    const arrow = isExpandable
      ? ArrowExpanderFactory({
        item,
        expanded,
      })
      : null;

    let ariaExpanded;
    if (this.props.isExpandable) {
      ariaExpanded = false;
    }
    if (this.props.expanded) {
      ariaExpanded = true;
    }

    const indents = Array.from({length: depth}).fill(treeIndent);
    let items = indents.concat(renderItem(item, depth, focused, arrow, expanded));

    return dom.div(
      {
        id,
        className: "tree-node" + (focused ? " focused" : ""),
        onClick: this.props.onClick,
        role: "treeitem",
        "aria-level": depth,
        "aria-expanded": ariaExpanded,
        "data-expandable": this.props.isExpandable
      },
      ...items
    );
  }
}

const ArrowExpanderFactory = createFactory(ArrowExpander);
const TreeNodeFactory = createFactory(TreeNode);

function oncePerAnimationFrame(fn) {
  let animationId = null;
  let argsToPass = null;
  return function (...args) {
    argsToPass = args;
    if (animationId !== null) {
      return;
    }

    animationId = requestAnimationFrame(() => {
      fn.call(this, ...argsToPass);
      animationId = null;
      argsToPass = null;
    });
  };
}

class Tree extends Component {
  static get propTypes() {
    return {

      getParent: PropTypes.func.isRequired,

      getChildren: PropTypes.func.isRequired,

      renderItem: PropTypes.func.isRequired,

      getRoots: PropTypes.func.isRequired,

      getKey: PropTypes.func.isRequired,

      isExpanded: PropTypes.func.isRequired,

      focused: PropTypes.any,

      onFocus: PropTypes.func,

      autoExpandDepth: PropTypes.number,
      autoExpandAll: PropTypes.bool,

      labelledby: PropTypes.string,
      label: PropTypes.string,

      onExpand: PropTypes.func,
      onCollapse: PropTypes.func,
      isExpandable: PropTypes.func,
      className: PropTypes.string,
      style: PropTypes.object,
    };
  }

  static get defaultProps() {
    return {
      autoExpandDepth: AUTO_EXPAND_DEPTH,
      autoExpandAll: true
    };
  }

  constructor(props) {
    super(props);

    this.state = {
      seen: new Set(),
    };

    this._onExpand = oncePerAnimationFrame(this._onExpand).bind(this);
    this._onCollapse = oncePerAnimationFrame(this._onCollapse).bind(this);
    this._focusPrevNode = oncePerAnimationFrame(this._focusPrevNode).bind(this);
    this._focusNextNode = oncePerAnimationFrame(this._focusNextNode).bind(this);
    this._focusParentNode = oncePerAnimationFrame(this._focusParentNode).bind(this);

    this._autoExpand = this._autoExpand.bind(this);
    this._preventArrowKeyScrolling = this._preventArrowKeyScrolling.bind(this);
    this._dfs = this._dfs.bind(this);
    this._dfsFromRoots = this._dfsFromRoots.bind(this);
    this._focus = this._focus.bind(this);
    this._scrollNodeIntoView = this._scrollNodeIntoView.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._nodeIsExpandable = this._nodeIsExpandable.bind(this);
  }

  componentDidMount() {
    this._autoExpand();
    if (this.props.focused) {
      this._scrollNodeIntoView(this.props.focused);
    }
  }

  componentWillReceiveProps(nextProps) {
    this._autoExpand();
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevProps.focused !== this.props.focused) {
      this._scrollNodeIntoView(this.props.focused);
    }
  }

  _autoExpand() {
    if (!this.props.autoExpandDepth) {
      return;
    }

    const autoExpand = (item, currentDepth) => {
      if (currentDepth >= this.props.autoExpandDepth ||
          this.state.seen.has(item)) {
        return;
      }

      this.props.onExpand(item);
      this.state.seen.add(item);

      const children = this.props.getChildren(item);
      const length = children.length;
      for (let i = 0; i < length; i++) {
        autoExpand(children[i], currentDepth + 1);
      }
    };

    const roots = this.props.getRoots();
    const length = roots.length;
    if (this.props.autoExpandAll) {
      for (let i = 0; i < length; i++) {
        autoExpand(roots[i], 0);
      }
    } else if (length != 0) {
      autoExpand(roots[0], 0);
    }
  }

  _preventArrowKeyScrolling(e) {
    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight":
        e.preventDefault();
        e.stopPropagation();
        if (e.nativeEvent) {
          if (e.nativeEvent.preventDefault) {
            e.nativeEvent.preventDefault();
          }
          if (e.nativeEvent.stopPropagation) {
            e.nativeEvent.stopPropagation();
          }
        }
    }
  }

  _dfs(item, maxDepth = Infinity, traversal = [], _depth = 0) {
    traversal.push({ item, depth: _depth });

    if (!this.props.isExpanded(item)) {
      return traversal;
    }

    const nextDepth = _depth + 1;

    if (nextDepth > maxDepth) {
      return traversal;
    }

    const children = this.props.getChildren(item);
    const length = children.length;
    for (let i = 0; i < length; i++) {
      this._dfs(children[i], maxDepth, traversal, nextDepth);
    }

    return traversal;
  }

  _dfsFromRoots(maxDepth = Infinity) {
    const traversal = [];

    const roots = this.props.getRoots();
    const length = roots.length;
    for (let i = 0; i < length; i++) {
      this._dfs(roots[i], maxDepth, traversal);
    }

    return traversal;
  }

  _onExpand(item, expandAllChildren) {
    if (this.props.onExpand) {
      this.props.onExpand(item);

      if (expandAllChildren) {
        const children = this._dfs(item);
        const length = children.length;
        for (let i = 0; i < length; i++) {
          this.props.onExpand(children[i].item);
        }
      }
    }
  }

  _onCollapse(item) {
    if (this.props.onCollapse) {
      this.props.onCollapse(item);
    }
  }

  _focus(item, options) {
    this._scrollNodeIntoView(item, options);
    if (this.props.onFocus) {
      this.props.onFocus(item);
    }
  }

  _scrollNodeIntoView(item, options = {}) {
    if (item !== undefined) {
      const treeElement = this.treeRef;
      const element = document.getElementById(this.props.getKey(item));
      if (element) {
        const {top, bottom} = element.getBoundingClientRect();
        const closestScrolledParent = node => {
          if (node == null) {
            return null;
          }

          if (node.scrollHeight > node.clientHeight) {
            return node;
          }
          return closestScrolledParent(node.parentNode);
        };
        const scrolledParent = closestScrolledParent(treeElement);
        var scrolledParentTop = 0;
        var scrolledParentBottom = 0;
        if (scrolledParent) {
            scrolledParentTop = scrolledParent.getBoundingClientRect().top;
            scrolledParentBottom = scrolledParent.getBoundingClientRect().bottom;
        }
        const isVisible = !scrolledParent
          || (
            top >= scrolledParentTop
            && bottom <= scrolledParentBottom
          );

        if (!isVisible) {
          let scrollToTop =
            (!options.alignTo && top < scrolledParentTop)
            || options.alignTo === "top";
          element.scrollIntoView(scrollToTop);
        }
      }
    }
  }

  _onBlur() {
    this._focus(undefined);
  }

  _onKeyDown(e) {
    if (this.props.focused == null) {
      return;
    }

    if (e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) {
      return;
    }

    this._preventArrowKeyScrolling(e);

    switch (e.key) {
      case "ArrowUp":
        this._focusPrevNode();
        return;

      case "ArrowDown":
        this._focusNextNode();
        return;

      case "ArrowLeft":
        if (this.props.isExpanded(this.props.focused)
            && this._nodeIsExpandable(this.props.focused)) {
          this._onCollapse(this.props.focused);
        } else {
          this._focusParentNode();
        }
        return;

      case "ArrowRight":
        if (this._nodeIsExpandable(this.props.focused)
            && !this.props.isExpanded(this.props.focused)) {
          this._onExpand(this.props.focused);
        } else {
          this._focusNextNode();
        }
    }
  }

  _focusPrevNode() {

    let prev;

    const traversal = this._dfsFromRoots();
    const length = traversal.length;
    for (let i = 0; i < length; i++) {
      const item = traversal[i].item;
      if (item === this.props.focused) {
        break;
      }
      prev = item;
    }
    if (prev === undefined) {
      return;
    }

    this._focus(prev, {alignTo: "top"});
  }

  _focusNextNode() {
    const traversal = this._dfsFromRoots();
    const length = traversal.length;
    let i = 0;

    while (i < length) {
      if (traversal[i].item === this.props.focused) {
        break;
      }
      i++;
    }

    if (i + 1 < traversal.length) {
      this._focus(traversal[i + 1].item, {alignTo: "bottom"});
    }
  }

  _focusParentNode() {
    const parent = this.props.getParent(this.props.focused);
    if (!parent) {
      this._focusPrevNode(this.props.focused);
      return;
    }

    const traversal = this._dfsFromRoots();
    const length = traversal.length;
    let parentIndex = 0;
    for (; parentIndex < length; parentIndex++) {
      if (traversal[parentIndex].item === parent) {
        break;
      }
    }

    this._focus(parent, {alignTo: "top"});
  }

  _nodeIsExpandable(item) {
    return this.props.isExpandable
      ? this.props.isExpandable(item)
      : !!this.props.getChildren(item).length;
  }

  render() {
    const traversal = this._dfsFromRoots();
    const {
      focused,
    } = this.props;

    const nodes = traversal.map((v, i) => {
      const { item, depth } = traversal[i];
      const key = this.props.getKey(item, i);
      return TreeNodeFactory({
        key,
        id: key,
        index: i,
        item,
        depth,
        renderItem: this.props.renderItem,
        focused: focused === item,
        expanded: this.props.isExpanded(item),
        isExpandable: this._nodeIsExpandable(item),
        onExpand: this._onExpand,
        onCollapse: this._onCollapse,
        onClick: (e) => {
          this._focus(item);
        },
      });
    });

    const style = Object.assign({}, this.props.style || {}, {
      padding: 0,
      margin: 0
    });

    return dom.div(
      {
        className: `tree ${this.props.className ? this.props.className : ""}`,
        ref: el => {
          this.treeRef = el;
        },
        role: "tree",
        tabIndex: "0",
        onKeyDown: this._onKeyDown,
        onKeyPress: (event) => {
          this._preventArrowKeyScrolling(event);

          if (this.props.onKeyPress) {
            this.props.onKeyPress(event);
          }
        },
        onKeyUp: this._preventArrowKeyScrolling,
        onFocus: ({nativeEvent}) => {
          if (focused || !nativeEvent || !this.treeRef) {
            return;
          }

          let { explicitOriginalTarget } = nativeEvent;
          if (explicitOriginalTarget !== this.treeRef &&
              !this.treeRef.contains(explicitOriginalTarget)) {
            this._focus(traversal[0].item);
          }
        },
        onBlur: this._onBlur,
        onClick: () => {
          this.treeRef.focus();
        },
        "aria-label": this.props.label,
        "aria-labelledby": this.props.labelledby,
        "aria-activedescendant": focused && this.props.getKey(focused),
        style,
      },
      nodes
    );
  }
}

