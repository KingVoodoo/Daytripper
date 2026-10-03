import {call,native} from './bridge';
export function configureScannerCapture(enabled:boolean,_owner?:Element) {
  if(native) void call('configure_clipboard_capture',{kind:'scanner',enabled}).catch(console.error);
}
