import { Component, OnInit } from '@angular/core';
import { ModelAddService } from './services/model-add.service';
import { ElementsService } from './services/elements.service';

// Import from other files
import { modelViewerSettings } from './viewer-settings';
import * as XLSX from 'xlsx';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  public modelViewerSettings = modelViewerSettings;
  public ifcElements: any[] = [];
  public fileName = 'ExcelSheet.xlsx';
  public fileUploaded: boolean = false;
  public excelData: any;
  public list: any;

  constructor(
    private _modelAdd: ModelAddService,
    private _elementService: ElementsService,
    private _comunica: ComunicaService
  ) {}

  ngOnInit(){
    this._comunica.getSources().subscribe(res => {
      console.log(res);
    })


    this.list = [
      {
        id: 1,
        title: 'IfcWall',
        checked: false,
      },
      {
        id: 2,
        title: 'IfcWindow',
        checked: false,
      },
      {
        id: 3,
        title: 'IfcSlab',
        checked: false,
      },
    ]
    return this.list
  } 

  get result() {
    return this.list.filter((item: { checked: boolean; }) => item.checked);
  }


  async onModelUpload(ev: any) {
    if (ev.target.files.leng == 0) {
      console.log('No file selected');
      return;
    }
    this.fileUploaded = true;

    let file: File = ev.target.files[0];

    await this._modelAdd.loadModel(file);
    console.log('Model loaded!');

  }

  async extractData() {
    for (var i of this.list) {
      if (i.checked) {
        this.ifcElements = await this._elementService.getProps(i.title);
    }}
  }

  clickedSpace(Pset: string) {
    console.log(Pset);
  }

  // exportResult(ev: any) {
  // // Export the data to json
  //   console.log('spaces');
  //   console.log(this.spaces);
  //   this.jsonExport = this._json_exportService.downloadFile(this.spaces);
  //   return this.jsonExport;
  // }

  exportExcel(): void {
    // Export the query data to excel 
    let element = document.getElementById('excel-table');
    const ws: XLSX.WorkSheet = XLSX.utils.table_to_sheet(element);

    /* generate workbook and add the worksheet */
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    /* save to file */
    XLSX.writeFile(wb, this.fileName);
  }


  

}
