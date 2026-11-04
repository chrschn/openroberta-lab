import * as MSG from 'message';
import * as LOG from 'log';
import * as UTIL from 'util.roberta';
import * as GUISTATE_C from 'guiState.controller';
import * as PROGRAM_C from 'program.controller';
import * as ROBOT_C from 'robot.controller';
import * as NN_C from 'nn.controller';
import * as CONFIGURATION_C from 'configuration.controller';
import * as PROGRAM from 'program.model';
import * as Blockly from 'blockly';
import * as $ from 'jquery';
import 'jquery-validate';

function init(callback, opt_callback) {
    $('#fileSelector').val(null);
    $('#fileSelector').off();
    $('#fileSelector').onWrap(
        'change',
        function (event) {
            var file = event.target.files[0];
            var reader = new FileReader();
            reader.onload = function (event) {
                var name = UTIL.getBasename(file.name);
                if (callback && typeof callback === 'function') {
                    callback(name, event.target.result, opt_callback);
                }
            };
            reader.readAsText(file);
            return false;
        },
        'import clicked'
    );
}

function importXml() {
    init(loadProgramFromXML);
    $('#fileSelector').attr('accept', '.xml');
    $('#fileSelector').clickWrap(); // opening dialog
    if ($('.rightMenuButton.rightActive').length > 0) {
        $('.rightMenuButton.rightActive').clickWrap();
    }
}

export function importXmlFromStart(startCallback) {
    init(loadProgramFromXMLStart, startCallback);
    $('#fileSelector').attr('accept', '.xml');
    $('#fileSelector').clickWrap(); // opening dialog
}
function importSourceCode(callback) {
    init(callback);
    $('#fileSelector').attr('accept', '.' + GUISTATE_C.getSourceCodeFileExtension());
    $('#fileSelector').clickWrap(); // opening dialog
}

function loadProgramFromXMLStart(name, xml, opt_callback) {
    var start = xml.indexOf('robottype="');
    start += 11;
    var end = xml.indexOf('"', start);
    var robot = xml.substring(start, end);
    var robotType;
    //TODO: This is only a fix for calliope and missing information in XML. Should be removed asap.
    if (robot.indexOf('calliope') >= 0) {
        robotType = 'calliope2017NoBlue';
    }
    for (const [key, value] of Object.entries(GUISTATE_C.getRobots())) {
        if (value['name'] === robot) {
            robotType = value['group'];
        }
    }
    if (robotType) {
        opt_callback && typeof opt_callback === 'function' && opt_callback(robotType, {}, loadProgramFromXML, [name, xml]);
    } else {
        MSG.displayInformation({ rx: 'error' }, '', Blockly.Msg.PROGRAM_IMPORT_ERROR_MISSING_ROBOT_TYPE, UTIL.getRobotGroupsPrettyPrint(robot));
    }
}

function loadProgramFromXML(name, xml) {
    if (xml.search('<export') === -1) {
        xml =
            '<export xmlns="http://de.fhg.iais.roberta.blockly"><program>' +
            xml +
            '</program><config>' +
            GUISTATE_C.getConfigurationXML() +
            '</config></export>';
    }
    PROGRAM.loadProgramFromXML(name, xml, function (result) {
        if (result.rc == 'ok') {
            NN_C.programWasReplaced(); // remember, that NN save must NOT be executed after import
            // save the old program and configuration that it can be restored
            var dom = Blockly.Xml.workspaceToDom(GUISTATE_C.getBlocklyWorkspace());
            var xmlProgOld = Blockly.Xml.domToText(dom);
            GUISTATE_C.setProgramXML(xmlProgOld);
            dom = Blockly.Xml.workspaceToDom(GUISTATE_C.getBricklyWorkspace());
            var xmlConfOld = Blockly.Xml.domToText(dom);
            GUISTATE_C.setConfigurationXML(xmlConfOld);
            var nameConfOld = GUISTATE_C.getConfigurationName();

            var neededExtensions = PROGRAM_C.getExtensionsNeededByProgram(GUISTATE_C.getRobot(), result.progXML);
            if (neededExtensions.nn && !GUISTATE_C.hasExtension('nn')) {
                // the program contains a neural network, but the robot works without the extension: activate it. The program replaces the current one anyway.
                var extensions = Object.assign({}, GUISTATE_C.getExtensions(), neededExtensions);
                ROBOT_C.switchRobot(GUISTATE_C.getRobot(), extensions, true, function () {
                    showImportedProgram(name, result, xmlProgOld, xmlConfOld, nameConfOld);
                });
            } else {
                showImportedProgram(name, result, xmlProgOld, xmlConfOld, nameConfOld);
            }
        } else {
            if (result.message === 'ORA_PROGRAM_IMPORT_ERROR_WRONG_ROBOT_TYPE') {
                MSG.displayInformation(result, '', result.message, result.robotTypes);
            } else {
                MSG.displayInformation(result, '', result.message, name);
            }
        }
    });
}

function showImportedProgram(name, result, xmlProgOld, xmlConfOld, nameConfOld) {
    // on server side we only test case insensitive block names, displaying xml can still fail:
    result.programSaved = false;
    result.name = 'NEPOprog';
    result.programShared = false;
    result.programTimestamp = '';
    try {
        CONFIGURATION_C.configurationToBricklyWorkspace(result.confXML);
        GUISTATE_C.setConfigurationXML(result.confXML);
        PROGRAM_C.programToBlocklyWorkspace(result.progXML);
        GUISTATE_C.setProgram(result);
        GUISTATE_C.setProgramXML(result.progXML);
        GUISTATE_C.setConfigurationNameForXML(result.confXML);
        LOG.info('show program ' + GUISTATE_C.getProgramName());
    } catch (e) {
        // restore old Program
        LOG.error(e.message);
        GUISTATE_C.setProgramXML(xmlProgOld);
        GUISTATE_C.setConfigurationXML(xmlConfOld);
        GUISTATE_C.setConfigurationName(nameConfOld);
        CONFIGURATION_C.reloadConf();
        PROGRAM_C.reloadProgram();
        result.rc = 'error';
        MSG.displayInformation(result, '', Blockly.Msg.ORA_PROGRAM_IMPORT_ERROR, name);
    }
}

/**
 * Open a file select dialog to load source code from local disk and send it
 * to the cross compiler
 */
function importSourceCodeToCompile() {
    init(compileFromSource);
    $('#fileSelector').attr('accept', '.' + GUISTATE_C.getSourceCodeFileExtension());
    $('#fileSelector').clickWrap(); // opening dialog
}

function compileFromSource(name, source) {
    PROGRAM.compileN(name, source, GUISTATE_C.getLanguage(), function (result) {
        var alertMsg = result.rc;
        if (result.parameters !== undefined) {
            alertMsg += '\nMessage is:\n' + result.parameters.MESSAGE;
        }
        alert(alertMsg);
    });
}

/**
 * Open a file select dialog to load source code from local disk and send it
 * to the cross compiler
 */

function importNepoCodeToCompile() {
    init(compileFromNepoCode);
    $('#fileSelector').attr('accept', '.xml');
    $('#fileSelector').clickWrap(); // opening dialog
}
export { init, importXml, importSourceCode, loadProgramFromXML, importSourceCodeToCompile, importNepoCodeToCompile };

function compileFromNepoCode(name, source) {
    PROGRAM.compileP(name, source, GUISTATE_C.getLanguage(), function (result) {
        alert(result.rc);
    });
}
