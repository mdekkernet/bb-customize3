#!/usr/bin/env node

const program = require('commander');
const walk = require('walkdir');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const sh = require('shelljs')
const xml2js = require('xml2js');
const version = require('./package.json').version;

program
  .version(version)
  .option('-t, --title <name>', 'Widget Title (eg. Custom Product Summary)')
  .option('-m, --module <module>', 'Module Name (eg. product-summary-extended)')
  .option('-s, --enable-slots', 'Enable Extension Slots (commented by default)', false)
  .option('-a, --project <project>', 'Project to add the widget to', false)
  .option('-d, --dist-path <path/to/compiled/libs>', 'Path to source widgets', './node_modules/@backbase')
  .option('-p, --widget-name-pattern <sub-string>', 'Filter out items', '-widget-ang')
  .usage('[options] <file ...>')
  .option('-l, --list', 'List all available widgets');

program.parse(process.argv);

const targetFolder = '.';
const enableExtensionSlots = program.enableSlots;
const backbaseFolder = program.distPath;
const widgetNamePattern = program.widgetNamePattern;

function createPrompt(widget) {
    var prompt = inquirer.createPromptModule();

    if (widget) {
        readWidget(widget, prompt);
        return;
    }

    const widgets = find_widgets().map(widget => widget.name);

    if(widgets.length) {
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
    fs.readFile(backbaseFolder + '/'+ widgetName + '/package.json', 'utf8', (err, contents) => {
        if(err) throw err;
        const packageJson = JSON.parse(contents);
        const npmName = packageJson.name;
        const title = packageJson.description;

        if(filledAnswers){
            doGenerate(filledAnswers);
        } else {
            prompt([{
                type: 'input',
                name: 'title',
                message: 'What will be the Title of your Widget?',
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

            fs.readFile(backbaseFolder + '/'+ widgetName + '/public_api.d.ts', 'utf8', (err, contents) => {
                if(err) throw err;
                const widgetModuleMatch = contents.match(/(\S*WidgetModule)/gm);
                const widgetModuleName = widgetModuleMatch && widgetModuleMatch[0] || '__WidgetModule';
                addWidgetDependency(widgetDestination, answers.module, npmName, widgetModuleName);
            });

            Promise.all([copyFiles$, copyTemplate$]).then(([, widgetTag]) =>
                includeInputsAndOutputs(widgetDestination, answers.module, componentName, answers.title, npmName, widgetTag)
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
    // Find all available widgets in the node_modules/@backbase or in the dist/libs folder
    const widgets = [];
    if(!fs.existsSync(backbaseFolder)) return [];

    walk.sync(backbaseFolder, {max_depth: 1, "no_return": true}, (path) => {
        if(!path.includes(widgetNamePattern)) return;
        const pathComponents = path.split('/');
        widgets.push({
            name: pathComponents[pathComponents.length - 1],
            path,
        });
    });
    return widgets;
}

// Generate a new Widget
function generateWidget(name) {
    const generateCommand = `ng generate widget ${name}` + (program.project ? ' --project ' + program.project : '');
    console.log('Running command:', generateCommand);
    return sh.exec(`npx ${generateCommand}`);
}

// Create Templates.html file
function copyTemplate(targetFolder, backbaseFolder, widgetDestination, widget, title, answers) {
    return new Promise((done, reject) => {
        const sourceMap = `${backbaseFolder}/${widget}/bundles/backbase-${widget}.umd.js`;
        fs.readFile(sourceMap, 'utf8', (err, contents) => {
            const regex = /<ng-template[^>]*Customizable.*<\/ng-template>/g;
            const matches = contents.match(regex);

            let matchString = matches.join('\n');
            matchString = matchString.replace(/\\n/g, '\n');
            matchString = matchString.replace(/\\"/g, '"');

            const widgetTag = `bb-${widget.replace(/-ang$/, '')}`
            if (!enableExtensionSlots) {
                matchString = matchString.replace(/<!--/g, '<! --');
                matchString = matchString.replace(/-->/g, '-- >');
                matchString = `<!-- \n${matchString}\n -->`;
            }

            matchString = `<${widgetTag}></${widgetTag}>\n\n${matchString}`;

            const templateFile = widgetDestination +'/'+ answers.module + '.component.html';
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
    const sourcePath = backbaseFolder + '/'+ widget + '/backbase-items';
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

// Show a list of all available source widgets
if(program.list){
    console.log('Available widgets:');

    const widgets = find_widgets();
    if(widgets.length){
        widgets.forEach(w => console.log(w.name));
    }
    else {
        console.error('Could not find node_modules, did you run npm install?');
    }

    return
}

// Provided source, target name & target module
if(program.title && program.module){
    console.log(`GENERATING: ${program.args[0]}, title: "${program.title}", module: ${program.module}`)
    readWidget(program.args[0], null, {
        title: program.title,
        module: program.module
    })

    return
}

// Provided only source name
if (program.args.length > 0){
    createPrompt(program.args[0]);
}

// No parameters passed
if (program.args.length === 0) {
    createPrompt();
}