import * as vscode from 'vscode';
import * as cp from 'child_process';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	vscode.window.showInformationMessage('Thanks for download my extension, DevStarter is now active. Press Ctrl + shift + p to start and search StartProyect');

	const disposable = vscode.commands.registerCommand('devstarter.StartProyect', () => {
		CreateProyect();
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	vscode.window.showInformationMessage('DevStarter is not active');
}

// this method 
export async function CreateProyect(){
	const projectname = await vscode.window.showInputBox({
		placeHolder: 'Enter the name of your new project',
		prompt: 'Enter the name of your new project'
	});

	const framework = await vscode.window.showQuickPick(
		['Frontend', 'Backend', 'MetaFramework'],
		{
			placeHolder: 'Select the type of framework',
		}
	);

	const frontend = await vscode.window.showQuickPick(
		['React', 'Angular', 'Vue'],
		{
			placeHolder: 'Type React | Angular | Vue',
		}
	);
	
	const backend = await vscode.window.showQuickPick(
		['NodeJS', 'Django', 'Vue'],
		{
			placeHolder: 'Type NodeJS | Django | Vue',
		}
	);

	const metaframework = await vscode.window.showQuickPick(
	['React', 'Angular', 'Vue'],
	{
		placeHolder: 'Type React | Angular | Vue',
	}
	);
	

	if(!projectname){
		vscode.window.showInformationMessage('Cancelled');
		return;
	}

	if(!framework){
		vscode.window.showInformationMessage('Cancelled');
		return;
	}

	const terminal = vscode.window.createTerminal('DevStarter');
	terminal.show();

	if(framework === 'Frontend'){
		
	}

	else if(framework === 'Backend'){

	}

	else if(framework === 'MetaFramework'){

	}
}