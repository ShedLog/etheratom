'use babel'
// web3.js should be use to handle all web3 compilation events
// Every solidity file can be compiled in two ways jsvm and ethereum endpoint
// After every command is invoked compilation endpoint should be chosen
// If JsVM is compilation endpoint VM will be used to compile and execute solidity program
import { CompositeDisposable } from 'atom'
import path from 'path'
import fs from 'fs'
import Web3 from 'web3'
import Web3Helpers from './methods'

let View, helpers;
View = require('./view');


class Web3Env {
	constructor() {
		this.subscriptions = new CompositeDisposable();
		this.web3Subscriptions = new CompositeDisposable();
		this.saveSubscriptions = new CompositeDisposable();
		this.compileSubscriptions = new CompositeDisposable();
		this.observeConfig();
	}
	dispose() {
		if(this.subscriptions) {
			this.subscriptions.dispose()
		}
		this.subscriptions = null

		if(this.saveSubscriptions) {
			this.saveSubscriptions.dispose()
		}
		this.saveSubscriptions = null

		if(this.web3Subscriptions) {
			this.web3Subscriptions.dispose()
		}
		this.web3Subscriptions = null
	}
	destroy() {
		if(this.saveSubscriptions) {
			this.saveSubscriptions.dispose()
		}
		this.saveSubscriptions = null

		if(this.compileSubscriptions) {
			this.compileSubscriptions.dispose()
		}
		this.compileSubscriptions = null

		if(this.web3Subscriptions) {
			this.web3Subscriptions.dispose()
		}
		this.web3Subscriptions = null
	}
	observeConfig() {
		this.subscriptions.add(atom.config.observe('etheratom.executionEnv', (executionEnv) => {
			if(this.web3Subscriptions) {
				this.destroy();
			}
			this.web3Subscriptions = new CompositeDisposable();
			if(executionEnv == 'web3') {
				this.subscribeToWeb3Commands();
				this.subscribeToWeb3Events();
			} else {
				return;
			}
		}));
		this.subscriptions.add(atom.config.onDidChange('etheratom.executionEnv', (envChange) => {
			if(envChange.newValue !== 'web3') {
				this.destroy();
			}
			if(envChange.newValue == 'web3') {
				if(this.web3Subscriptions) {
					this.web3Subscriptions.dispose();
				}
				this.web3Subscriptions = new CompositeDisposable();
				this.subscribeToWeb3Commands();
				this.subscribeToWeb3Events();
			}
		}));
	}

	// Subscriptions
	subscribeToWeb3Commands() {
		if(!this.web3Subscriptions) {
			return
		}
		this.web3Subscriptions.add(atom.commands.add('atom-workspace', 'eth-interface:compile', () => {
			if(this.compileSubscriptions) {
				this.compileSubscriptions.dispose();
			}
			this.compileSubscriptions = new CompositeDisposable();
			this.subscribeToCompileEvents();
		}));
		this.web3Subscriptions.add(atom.commands.add('atom-workspace', 'eth-interface:make', () => {
			this.subscribeToMakeEvents();
		}));
	}
	subscribeToWeb3Events() {
		if(!this.web3Subscriptions) {
			return
		}
		rpcAddress = atom.config.get('etheratom.rpcAddress');
		if(typeof this.web3 !== 'undefined') {
			this.web3 = new Web3(this.web3.currentProvider);
		} else {
			this.web3 = new Web3(new Web3.providers.HttpProvider(rpcAddress));
			this.helpers = new Web3Helpers(this.web3);
		}
		this.view = new View(this.web3);
		this.checkConnection((error, connection) => {
			if(error) {
				this.helpers.showPanelError(error);
			} else if(connection) {
				this.view.createCompilerOptionsView();
				this.view.createCoinbaseView();
				this.view.createButtonsView();
			}
		});
		this.web3Subscriptions.add(atom.workspace.observeTextEditors((editor) => {
			if(!editor || !editor.getBuffer()) {
				return
			}

			this.web3Subscriptions.add(atom.config.observe('etheratom.compileOnSave', (compileOnSave) => {
				if(this.saveSubscriptions) {
					this.saveSubscriptions.dispose();
				}
				this.saveSubscriptions = new CompositeDisposable();
				if(compileOnSave) {
					this.subscribeToSaveEvents();
				}
			}));
		}));
	}

	// Event subscriptions
	subscribeToSaveEvents() {
		if(!this.web3Subscriptions) {
			return
		}
		this.saveSubscriptions.add(atom.workspace.observeTextEditors((editor) => {
			if(!editor || !editor.getBuffer()) {
				return
			}

			const bufferSubscriptions = new CompositeDisposable()
			bufferSubscriptions.add(editor.getBuffer().onDidSave((filePath) => {
				this.compile(editor)
			}))
			bufferSubscriptions.add(editor.getBuffer().onDidDestroy(() => {
				bufferSubscriptions.dispose()
			}))
			this.saveSubscriptions.add(bufferSubscriptions)
		}));
	}
	subscribeToCompileEvents() {
		if(!this.web3Subscriptions) {
			return
		}
		this.compileSubscriptions.add(atom.workspace.observeTextEditors((editor) => {
			if(!editor || !editor.getBuffer()) {
				return
			}
			this.compile(editor);
		}));
	}
	subscribeToMakeEvents() {
		if(!this.compileSubscriptions) {
			return
		}
		this.make(this.compiled)
	}

	// common functions
	checkConnection(callback) {
		let haveConn;
		haveConn = this.web3.isConnected();
		if(!haveConn) {
			return callback('Error could not connect to local geth instance!', null);
		} else {
			return callback(null, true);
		}
	}
	combineSource(dir, source, imports) {
		let fn, iline, ir, match, o, subSource;
		o = {
			encoding: 'UTF-8'
		};
		ir = /import\ [\'\"](.+)[\'\"]\;/g;
		match = null;
		while((match = ir.exec(source))) {
			iline = match[0];
			fn = match[1];
			if(imports[fn]) {
				source = source.replace(iline, '');
				continue;
			}
			imports[fn] = 1;
			subSource = fs.readFileSync(dir + "/" + fn, o);
			match.source = this.combineSource(dir, subSource, imports);
			source = source.replace(iline, match.source);
		}
		return source;
	}
	compile(editor) {
		let filename, filePath, dir, source;

		filePath = editor.getPath();
		filename = filePath.replace(/^.*[\\\/]/, '');
		if(filePath.split('.').pop() == 'sol') {
			dir = path.dirname(filePath);
			source = this.combineSource(dir, editor.getText(), {});
			this.helpers.compileWeb3(source, (error, compiled) => {
				if(error) {
					this.helpers.showPanelError(error);
				}
				if(compiled) {
					// Handle compilation returns
					if(compiled.errors) {
						this.view.viewErrors(compiled.errors);
					} else {
						// Reset compiled code view before compiling new contract
						this.view.reset();
						this.view.viewCompiled(compiled);
						this.compiled = compiled;
					}
				}
			});
		} else {
			return;
		}
	}
	make(compiled) {
		for(contractName in compiled) {
			let variables, estimatedGas, bytecode, ContractABI, inputVars, constructVars, createButton;
			constructVars = [];
			variables = [];
			estimatedGas = 0;
			if(document.getElementById(contractName + '_create')) {
				bytecode = compiled[contractName].code;
				ContractABI = compiled[contractName].info.abiDefinition;
				inputVars = document.getElementById(contractName + '_inputs') ? document.getElementById(contractName + '_inputs').getElementsByTagName('input') : null;
				if(inputVars) {
					for(var inputItem of inputVars) {
						if(inputItem.getAttribute('id') === contractName + '_gas') {
							estimatedGas = inputItem.value;
							inputItem.readOnly = true;
							break;
						}
						inputObj = {
							"varName": inputItem.getAttribute('id'),
							"varValue": inputItem.value
						};
						variables.push(inputObj);
						inputItem.readOnly = true;
						if(inputItem.nextSibling.getAttribute('id') === contractName + '_create') {
							break;
						}
					}
					constructVars[contractName] = {
						'contractName': contractName,
						'inputVariables': variables,
						'estimatedGas': estimatedGas
					};
				}
				createButton = React.createClass({
					displayName: 'createButton',
					_handleSubmit: function() {
						return this.create(compiled[Object.keys(this.refs)[0]].info.abiDefinition, compiled[Object.keys(this.refs)[0]].code, constructVars[Object.keys(this.refs)[0]], Object.keys(this.refs)[0], constructVars[Object.keys(this.refs)[0]].estimatedGas);
					},
					render: function() {
						return React.createElement('form', {
							onSubmit: this._handleSubmit
						}, React.createElement('input', {
							type: 'submit',
							value: 'Create',
							ref: contractName,
							className: 'btn btn-primary inline-block-tight'
						}, null));
					}
				});
				ReactDOM.render(React.createElement(createButton, null), document.getElementById(contractName + '_create'));
			}
		}
	}
}
export { Web3Env }
