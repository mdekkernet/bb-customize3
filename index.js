#!/usr/bin/env node

const program = require('commander');
const walk = require('walkdir');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const sh = require('shelljs')
const xml2js = require('xml2js');

program
  .version('1.0.0')
  .usage('[options] <file ...>')
  .option('--list', 'List all available widgets')

const targetFolder = '.';
const backbaseFolder =  "/node_modules/@backbase";

program.command('*').action(createPrompt);

// no parameters passed
if (process.argv.length === 2) {
    createPrompt();
}

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

function readWidget(widgetName, prompt) {
    fs.readFile(targetFolder + backbaseFolder + '/'+ widgetName + '/package.json', 'utf8', (err, contents) => {
        if(err) throw err;
        const packageJson = JSON.parse(contents);
        const npmName = packageJson.name;
        const title = packageJson.description;

         prompt([{
            type: 'input',
            name: 'title',
            message: 'What will be the name of your component?',
            default: 'Custom ' + title
        },
        {
            type: 'input',
            name: 'widget',
            message: 'What will be the name of your widget?',
            default: 'custom-' + widgetName.replace(/-ang$/, '')
        }]).then((answers) => {
            /* const answers = {
                widget: "ct-contact-manager-widget",
                title: "Custom Contact Manager Widget",
            }; */
            const widgetDestination = targetFolder + '/libs/' + answers.widget  + '/src';

            generateWidget(answers.widget);
            componentName = snake2TitleCase(answers.widget) + 'Component';

            const copyFiles$ = copyFiles(targetFolder, backbaseFolder, widgetName, answers.widget);

            const copyTemplate$ = copyTemplate(targetFolder, backbaseFolder, widgetDestination, widgetName, title, answers);

            fs.readFile(targetFolder + backbaseFolder + '/'+ widgetName + '/public_api.d.ts', 'utf8', (err, contents) => {
                if(err) throw err;
                const widgetModuleMatch = contents.match(/(\S*WidgetModule)/gm);
                const widgetModuleName = widgetModuleMatch && widgetModuleMatch[0] || '__WidgetModule';
                addWidgetDependency(widgetDestination, answers.widget, npmName, widgetModuleName);
            });

            Promise.all([copyFiles$, copyTemplate$]).then(() =>
                includeInputsAndOutputs(widgetDestination, answers.widget, componentName, answers.title)
            );
        });
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
            matchString = `<${widgetTag}></${widgetTag}>\n<!-- \n${matchString}\n -->`;

            const templateFile = widgetDestination +'/'+ answers.widget + '.component.html';
            fs.writeFile(templateFile, matchString, (err) => {
                if (err) throw err;
                console.log('Saved Template');
                done();
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
function addPreferencesToComponent(widgetDestination, name, preferences) {
    // @Input()
    // preferenceName?: String;

    // Update component
    const componentFile = widgetDestination + `/${name}.component.ts`;
    fs.readFile(componentFile, 'utf8', (err, contents) => {
        if(err) throw err;
        contents = contents.replace(/template: `[^`]*`/g, `templateUrl: './${name}.component.html'`);

        fs.writeFile(componentFile, contents, (err) => {
            if (err) throw err;
        });
    });

}

// Include the widget inside the template
function addPreferencesToTemplate(widgetDestination, name, preferences) {
    // <wrapped-widget
    // [preferenceName]="preferenceName"
}

// Extract the inputs and outputs and wire them inside the component
function includeInputsAndOutputs(widgetDestination, widgetName, componentName, widgetTitle) {
    return new Promise((resolve, reject) => {
        const modelXmlFile = widgetDestination + '/../model.xml';
        fs.readFile(modelXmlFile, 'utf8', (err, contents) => {
            if (err) throw err;

            xml2js.parseString(contents, (err, model) => {
                if (err) throw err;
                const inputsAndOutputs = findPreferences(model, widgetDestination);

                const component$ = addPreferencesToComponent(widgetDestination, widgetName, inputsAndOutputs);
                const template$ = addPreferencesToTemplate(widgetDestination, widgetName, inputsAndOutputs);

                // Replacing values
                model.catalog.widget[0].name = widgetName;
                const preferences = model.catalog.widget[0].properties[0].property;

                const titlePreference = preferences.find((pref) => pref.$.name == 'title');
                titlePreference.value[0]._ = widgetTitle;

                const classId = preferences.find((pref) => pref.$.name == 'classId');
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
program.parse(process.argv);

if(program.list){
    console.log('Available widgets:');

    if(fs.existsSync(targetFolder + backbaseFolder)){
        const widgets = find_widgets();
        widgets.forEach(w => console.log(w));
    }
    else {
        console.error('Could not find node_modules, did you run npm install?');
    }
}