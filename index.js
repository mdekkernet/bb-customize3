#!/usr/bin/env node

const program = require('commander');
const walk = require('walkdir');
const fs = require('fs-extra');
const inquirer = require('inquirer');
 
program
  .version('1.0.0')
  .usage('[options] <file ...>')
  .option('--list', 'List all available widgets')

const targetFolder = '.'; //'/Users/martijnd/backbase/customer-abn-poc-clearing/statics/wc3-demo'
const backbaseFolder =  "/node_modules/@backbase";

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

program.command('*').action(function(widget){
    var prompt = inquirer.createPromptModule();
    
    fs.readFile(targetFolder + backbaseFolder + '/'+ widget + '/package.json', 'utf8', function(err, contents) {
        const title = JSON.parse(contents).description;

        prompt([{
            type: 'input',
            name: 'component',
            message: 'What will be the name of your component?',
            default: title
        },
        {
            type: 'input',
            name: 'widget',
            message: 'What will be the name of your widget?',
            default: widget
        }]).then((answers) => {
            // Copy the Model.xml file
            walk.sync(targetFolder + backbaseFolder + '/'+ widget + '/backbase-items', {max_depth: 2, "no_return": true}, (path) => {
                if(path.indexOf('model.xml') != -1){
                    fs.copy(path, targetFolder + '/libs/' + answers.widget + '/model.xml');
                }
            });

            // Create a Wrapped Widget ts file

            // Create Templates.html file
            const sourceMap = targetFolder + backbaseFolder + '/'+ widget + '/esm5/backbase-'+ widget +'.js';
            console.log(sourceMap);
            fs.readFile(sourceMap, 'utf8', function(err, contents) {
                const regex = /<ng-template.*<\/ng-template>/g;
                const matches = contents.match(regex);
                
                const widgetDestination = targetFolder + '/libs/' + answers.widget  + '/src';
                fs.ensureDir(widgetDestination);

                let matchString = matches.join('\n');
                matchString = matchString.replace(/\\n/g, '\n');
                matchString = matchString.replace(/\\"/g, '"');
                
                fs.writeFile(widgetDestination +'/'+ answers.component + '.component.html', matchString, function (err) {
                    if (err) throw err;
                    console.log('Saved!');
                });
            });
        });
    });


  });

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