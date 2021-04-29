import { Directive, EventEmitter, HostBinding, HostListener, Output } from '@angular/core';

@Directive({
  selector: '[appDragAndDrop]'
})
export class DragAndDropDirective {
  @Output() fileDropped = new EventEmitter<any>();

  constructor() { }

  @HostBinding('class.file-over') fileOver: boolean;

  // DragOver listener
  @HostListener('dragover', ['$event']) public onDragOver(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    this.fileOver = true;
    console.log('Dragover');
  }

  // DragLeave listener
  @HostListener('dragleave', ['$event']) public onDragLeave(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    this.fileOver = false;
    console.log('DragLeave');
  }

  // Drop listener
  @HostListener('drop', ['$event']) public ondrop(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    console.log('Drop');
    this.fileOver = false;
    this.fileDropped.emit(evt);
  }

}
