window.Zotero = window.Zotero || {};
Zotero.UI = Zotero.UI || {};

Zotero.UI.ModalPrompt = class ModalPrompt extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			checkboxChecked: this.props.checkboxChecked || false,
			checkboxBlocked: this.props.checkboxBlock && !this.props.checkboxChecked || false,
			onButton: this.props.onButton || this.props.onClose,
			inputText: this.props.inputText || "",
		};
		
		this.escListener = this.escListener.bind(this);
		this.onInputChange = this.onInputChange.bind(this);
		this.onCheckboxChange = this.onCheckboxChange.bind(this);
		this.onInputChange = this.onInputChange.bind(this);
	}
	
	componentDidMount() {
		document.addEventListener('keyup', this.escListener);
		setTimeout(() => {
			window.focus();
			this.refs.button1.focus()
		}, 50);
	}
	
	componentWillUnmount() {
		document.removeEventListener('keyup', this.escListener);
	}
	
	attachButtonListeners() {
		window.requestAnimationFrame(function() {
			for (let a of document.querySelectorAll('.ModalPrompt-buttons input[type=button]')) {
				a.addEventListener('click', (event) => {
					event.stopPropagation();
					this.state.onButton(this.state, event);
				}, false);
			}
		}.bind(this));
	}
	
	escListener(event) {
		if (event.key == "Escape") {
			this.props.onClose(this.state);
			event.preventDefault();
		}
	}
	
	onCheckboxChange() {
		this.setState({checkboxChecked: !this.state.checkboxChecked, 
			checkboxBlocked: this.props.checkboxBlock && this.state.checkboxChecked});
	}
	
	onInputChange(event) {
		this.setState({inputText: event.value});
	}
	
	render() {
		var checkbox, input, buttons = ["", "", ""];
		checkbox = input = "";
		
		if (this.props.checkbox) {
			checkbox = (<p className="checkbox">
				<label style={{
						fontWeight: "initial",
						lineHeight: "18px"}}>
					<input type="checkbox"
						style={{margin: "3px 7px 3px 3px" }}
						checked={this.state.checkboxChecked}
						onChange={this.onCheckboxChange}/>
					{this.props.checkboxText}
				</label>
			</p>);
		}
		
		if (this.props.input) {
			input = (<p className="input">
				<label>
					<input value={this.state.inputText} placeholder={this.state.inputPlaceholder} onChange={this.onInputChange}/>
				</label>
			</p>);
		}
		
		for (let i = 1; i <= 3; i++) {
			if (this.props[`button${i}Text`].length) {
				buttons[i-1] = <input type="button" name={i} value={this.props[`button${i}Text`]}
					disabled={i==1 && this.state.checkboxBlocked}
					ref={`button${i}`}
					className="ModalPrompt-button"/>
			}
		}
		
		this.attachButtonListeners();
		
		let onClickOutside = e => {
			e.stopPropagation();
			if (this.props.clickOutsideToClose
					&& e.target.classList.contains('z-modal-overlay')) {
				this.props.onClose(this.state, e);
			}
		};
		
		let message = this.props.children || this.props.message;
		if (typeof message == "string") {
			message = DOMPurify.sanitize(message);
			message = <span dangerouslySetInnerHTML={{__html: message}}/>
		}
		let platform = Zotero.isMac ? "mac" : Zotero.isWin ? "win" : "unix";
		return (<div className="ModalPrompt-overlay" onClick={onClickOutside}>
			<div className={`ModalPrompt ModalPrompt--${platform}`} role="dialog"
					aria-labelledby="zotero-modal-prompt-title"
					aria-describedby="zotero-modal-prompt-message">
				<div className="ModalPrompt-content">
					<img className="ModalPrompt-icon" src={`../images/zotero-app-${platform}.png`} alt=""/>
					<div>
						<h2 id="zotero-modal-prompt-title" className="ModalPrompt-title">
							{this.props.title}
						</h2>
						<p id="zotero-modal-prompt-message" className="ModalPrompt-body">
							{message}
						</p>
						{checkbox}
						{input}
					</div>
				</div>
				<div className="ModalPrompt-buttons">
					{buttons[2]}
					<span style={{flexGrow: 1}}/>
					{buttons[1]}
					{buttons[0]}
				</div>
			</div>
		</div>)
	}
};

Zotero.UI.ModalPrompt.defaultProps = {
	title: "Zotero Connector",
	checkbox: false,
	checkboxText: "",
	checkboxBlock: false,
	input: false,
	inputPlaceholder: "",
	button1Text: "OK",
	button2Text: "Cancel",
	button3Text: "",
	clickOutsideToClose: false
};

Zotero.UI.ModalPrompt.PropTypes = {
	title: PropTypes.string,
	checkbox: PropTypes.bool,
	checkboxChecked: PropTypes.bool,
	checkboxBlock: PropTypes.bool,
	input: PropTypes.bool,
	button1Text: PropTypes.string,
	button2Text: PropTypes.string,
	button3Text: PropTypes.string,
	clickOutsideToClose: PropTypes.bool,
	onClose: PropTypes.func.isRequired,
	onButton: PropTypes.func,
	message: PropTypes.any,
	children: PropTypes.any
};
