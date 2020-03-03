#!/usr/bin/env node

const program = require('commander');
const walk = require('walkdir');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const sh = require('shelljs')
const xml2js = require('xml2js');

program
  .version('1.0.0')
  .option('-n, --name <name>', 'Widget Title (eg. Custom Product Summary)')
  .option('-m, --module <module>', 'Module Name (eg. product-summary-extended)')
  .usage('[options] <file ...>')
  .option('--list', 'List all available widgets');

const targetFolder = '.';
const backbaseFolder =  "/node_modules/@backbase";

function createPrompt(widget) {
    var prompt = inquirer.createPromptModule();

    if (widget) {
        readWidget(widget, prompt);
        return;
    }

    if(fs.existsSync(targetFolder + backbaseFolder)){
        const widgets = find_widgets();
        prompt([{
            type: 'list',
            choices: widgets,
            name: 'name',
            message: 'Select the the widget to extend',
        }]).then((answers) => {
            readWidget(answers.name, prompt);
        });
    }
    else {
        console.error('Could not find node_modules, did you run npm install?');
    }
};

function readWidget(widgetName, prompt, filledAnswers) {
    fs.readFile(targetFolder + backbaseFolder + '/'+ widgetName + '/package.json', 'utf8', (err, contents) => {
        if(err) throw err;
        const packageJson = JSON.parse(contents);
        const npmName = packageJson.name;
        const title = packageJson.description;

        if(filledAnswers){
            doGenerate(filledAnswers);
        } else {
            prompt([{
                type: 'input',
                name: 'name',
                message: 'What will be the Name of your Widget?',
                default: 'Extended ' + title
            },
            {
                type: 'input',
                name: 'module',
                message: 'What will be Module Name that is referenced by the app?',
                default: widgetName.replace(/-ang$/, '') + '-extended'
            }]).then(doGenerate);
        }

        function doGenerate(answers) {
            const widgetDestination = targetFolder + '/libs/' + answers.module  + '/src';

            generateWidget(answers.module);
            componentName = snake2TitleCase(answers.module) + 'Component';

            const copyFiles$ = copyFiles(targetFolder, backbaseFolder, widgetName, answers.module);
            const copyTemplate$ = copyTemplate(targetFolder, backbaseFolder, widgetDestination, widgetName, title, answers);

            fs.readFile(targetFolder + backbaseFolder + '/'+ widgetName + '/public_api.d.ts', 'utf8', (err, contents) => {
                if(err) throw err;
                const widgetModuleMatch = contents.match(/(\S*WidgetModule)/gm);
                const widgetModuleName = widgetModuleMatch && widgetModuleMatch[0] || '__WidgetModule';
                addWidgetDependency(widgetDestination, answers.module, npmName, widgetModuleName);
            });

            Promise.all([copyFiles$, copyTemplate$]).then(([, widgetTag]) =>
                includeInputsAndOutputs(widgetDestination, answers.module, componentName, answers.name, npmName, widgetTag)
            );
        }
    });
}

function snake2TitleCase(val) {
    return val
        .toLowerCase()
        .replace(/([ -_]|^)(.)/g, function (allMatches, firstMatch, secondMatch) {
            return secondMatch.toUpperCase();
        });
}

// Search the node_modules folder for valid widgets
function find_widgets(){
    var files = [];

    // Find all available widgets
    const customExtensionDir = targetFolder + backbaseFolder;
    walk.sync(customExtensionDir, {max_depth: 1, "no_return": true}, (path) => {
        if(path.indexOf('-widget-ang') != -1){
            const pathComponents = path.split('/');
            files.push(pathComponents[pathComponents.length - 1]);
        }
    });

    return files;
}

// Generate a new Widget
function generateWidget(name) {
    const generateCommand = `ng generate widget ${name}`;
    console.log('Running command:', generateCommand);
    return sh.exec(`npx ${generateCommand}`);
}

// Create Templates.html file
function copyTemplate(targetFolder, backbaseFolder, widgetDestination, widget, title, answers) {
    return new Promise((done, reject) => {
        const sourceMap = targetFolder + backbaseFolder + '/'+ widget + '/bundles/backbase-'+ widget +'.umd.js';
        fs.readFile(sourceMap, 'utf8', (err, contents) => {
            const regex = /<ng-template.*<\/ng-template>/g;
            const matches = contents.match(regex);

            let matchString = matches.join('\n');
            matchString = matchString.replace(/\\n/g, '\n');
            matchString = matchString.replace(/\\"/g, '"');
            matchString = matchString.replace(/<!--/g, '<! --');
            matchString = matchString.replace(/-->/g, '-- >');

            const widgetTag = `bb-${widget.replace(/-ang$/, '')}`
            matchString = `<${widgetTag}></${widgetTag}>\n\n<!-- \n${matchString}\n -->`;

            const templateFile = widgetDestination +'/'+ answers.widget + '.component.html';
            fs.writeFile(templateFile, matchString, (err) => {
                if (err) throw err;
                console.log('Saved Template');
                done(widgetTag);
            });
        });
    });
}

// Copy the Model.xml file
function copyFiles(targetFolder, backbaseFolder, widget, name) {
    const sourcePath = targetFolder + backbaseFolder + '/'+ widget + '/backbase-items';
    return new Promise((done, reject) => {
        walk.sync(sourcePath, {max_depth: 2, "no_return": true}, (path) => {
            const filesToCopy = [
                'model.xml',
                'options.json',
                'icon.png',
            ];
            filesToCopy.forEach(fileName => {
                if(path.includes(fileName)) {
                    fs.copy(path, targetFolder + '/libs/' + name + '/' + fileName);
                    console.log(`Copied ${fileName}`);
                    done();
                }
            });
        });
    });
}

// Add the original widget as dependency
function addWidgetDependency(widgetDestination, widgetDestinationName, npmName, widgetModuleName) {
    const widgetModule = `${widgetDestination}/${widgetDestinationName}.module.ts`;
    fs.readFile(widgetModule, 'utf8', (err, contents) => {
        if (err) throw err;

        contents = contents.replace('@NgModule({',[
            `import { BackbaseUiModule } from '@backbase/ui-ang';`,
            `import { ${widgetModuleName} } from \'${npmName}\';`,
            '',
            '@NgModule({'
        ].join('\n'));

        contents = contents.replace('imports: [', [
            'imports: [',
            `    ${widgetModuleName},`,
            '    BackbaseUiModule,'
        ].join('\n'));

        fs.writeFile(widgetModule, contents, (err) => {
            if (err) throw err;
            console.log('Added Widget Dependency');
        });
    });
}

// Add preferences to the component
function addPreferencesToComponent(widgetDestination, name, [inputs, outputs], npmName, originalComponentName) {
    // @Input()
    // preferenceName?: String;

    // Update component
    const componentFile = widgetDestination + `/${name}.component.ts`;
    fs.readFile(componentFile, 'utf8', (err, contents) => {
        if(err) throw err;

        const copyRoutesSnippet = `import { CopyRoutes } from '@backbase/foundation-ang/core';\n` +
            `import { ${originalComponentName} } from '${npmName}';\n\n` +
            `@CopyRoutes(${originalComponentName})\n$&`;

        let outputString = '';
        let handlerString = '';
        if (outputs && outputs.length) {
            outputs.forEach((val) => {
                const outputKey = val.split('output.')[1];
                if (!outputKey) return;
                outputString += `\n  @Output() ${outputKey} = new EventEmitter<any>();`;
                handlerString += `\n\n  ${getEventHandlerName(outputKey)}(data: any) {\n    this.${outputKey}.next(data);\n  }`;
            });
        }

        contents = contents.replace(/ } from '@angular\/core'/g, ', Output, EventEmitter$&');
        contents = contents.replace(/@Component/g, copyRoutesSnippet);
        contents = contents.replace(/template: `[^`]*`/g, `templateUrl: './${name}.component.html'`);
        contents = contents.replace('constructor() { }', `${outputString}\n\n  constructor() { }${handlerString}`);

        fs.writeFile(componentFile, contents, (err) => {
            if (err) throw err;
        });
    });

}

// Include the widget inside the template
function addPreferencesToTemplate(widgetDestination, name, [inputs, outputs], widgetTag) {

    // <wrapped-widget
    // [preferenceName]="preferenceName"

    const templateFile = widgetDestination + `/${name}.component.html`;
    fs.readFile(templateFile, 'utf8', (err, contents) => {
        if(err) throw err;

        let outputString = '';
        if (outputs && outputs.length) {
            outputs.forEach((val) => {
                const outputKey = val.split('output.')[1];
                if (!outputKey) return result;
                outputString += `\n  (${outputKey})="${getEventHandlerName(outputKey)}($event)"`;
            });
        }

        contents = contents.replace(`<${widgetTag}>`, `<${widgetTag}${outputString}\n>`);
        fs.writeFile(templateFile, contents, (err) => {
            if (err) throw err;
            console.log('Outputs added to the template');
        });
    });
}

// Extract the inputs and outputs and wire them inside the component
function includeInputsAndOutputs(widgetDestination, widgetName, componentName, widgetTitle, npmName, widgetTag) {
    return new Promise((resolve, reject) => {
        const modelXmlFile = widgetDestination + '/../model.xml';
        fs.readFile(modelXmlFile, 'utf8', (err, contents) => {
            if (err) throw err;

            xml2js.parseString(contents, (err, model) => {
                if (err) throw err;
                const inputsAndOutputs = findPreferences(model, widgetDestination);
                const preferences = model.catalog.widget[0].properties[0].property;
                const titlePreference = preferences.find((pref) => pref.$.name == 'title');
                const classId = preferences.find((pref) => pref.$.name == 'classId');

                const component$ = addPreferencesToComponent(widgetDestination, widgetName, inputsAndOutputs, npmName, classId.value);
                const template$ = addPreferencesToTemplate(widgetDestination, widgetName, inputsAndOutputs, widgetTag);

                // Replacing values
                model.catalog.widget[0].name = widgetName;
                titlePreference.value[0]._ = widgetTitle;
                classId.value = [componentName];

                var builder = new xml2js.Builder();
                var xmlContent = builder.buildObject(model);
                const writeModel$ = fs.writeFile(modelXmlFile, xmlContent);
                Promise.all([writeModel$, component$, template$]).then(() => resolve());
            })
        });
    });
}

function findPreferences(model, widgetDestination, callback){
    const inputs = [];
    const outputs = [];
    const defaultPreferences = ['classId', 'src', 'render.requires', 'title', 'thumbnailUrl'];

    const preferences = model.catalog.widget[0].properties[0].property;
    preferences.forEach((preference) => {
        if(defaultPreferences.indexOf(preference.$.name) != -1){
            return;
        }

        if(preference.$.name.indexOf('output.') == 0){
            outputs.push(preference.$.name);
            return;
        }

        inputs.push(preference.$.name);
    });

    console.log('Mapped Outputs:');
    console.log(outputs);

    console.log('Mapped Inputs:');
    console.log(inputs);

    return [inputs, outputs];
}

function getEventHandlerName(eventName) {
    return 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
}

program.parse(process.argv);

// Show a list of all available source widgets
if(program.list){
    console.log('Available widgets:');

    if(fs.existsSync(targetFolder + backbaseFolder)){
        const widgets = find_widgets();
        widgets.forEach(w => console.log(w));
    }
    else {
        console.error('Could not find node_modules, did you run npm install?');
    }

    return
}

// Provided source, target name & target module
if(program.name && program.module){
    console.log('GENERATING: '+program.args[0]+' name: '+program.name+' module: '+program.module)
    readWidget(program.args[0], null, {
        name: program.name,
        module: program.module
    })

    return
}

// Provided only source name
if (process.argv.length === 3){
    createPrompt(process.argv[2]);
}

// No parameters passed
if (process.argv.length === 2) {
    createPrompt();
}