import { Component, OnInit } from '@angular/core';
import { JsonExportService } from './services/json-export.service';
import { ModelAddService } from './services/model-add.service';
import { SpacesService } from './services/spaces.service';
import {
  IFCViewerService,
  LoadingStatus,
  ModelFileType,
  ModelLoaderService,
} from 'ngx-ifc-viewer';

// Import from other files
import { modelViewerSettings } from './viewer-settings';
import { LBDParsersService } from 'ngx-lbd-parsers';
import { ComunicaService, Source, SourceType } from 'ngx-comunica';
import * as XLSX from 'xlsx';
import { Binary } from '@angular/compiler';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  public modelViewerSettings = modelViewerSettings;
  public spaces: any[] = [];
  public uValues: any[] = [];
  public createdUValues: any[] = [];
  public jsonExport: any;
  fileName = 'ExcelSheet.xlsx';
  public fileUploaded: boolean = false;
  public exportedToExcel: boolean = false;
  public readyToCal: boolean = false;
  public excelData: any;

  constructor(
    private _modelAdd: ModelAddService,
    private _spaceService: SpacesService,
    private _json_exportService: JsonExportService,
    private _comunica: ComunicaService
  ) {}

  ngOnInit(){
    this._comunica.getSources().subscribe(res => {
      console.log(res);
    })
  }

  async onModelUpload(ev: any) {
    if (ev.target.files.lenght == 0) {
      console.log('No file selected');
      return;
    }
    this.fileUploaded = true;

    let file: File = ev.target.files[0];

    await this._modelAdd.loadModel(file);
    console.log('Model loaded!');

    // Binds the results from services/spaces to the variable spaces
    this.spaces = await this._spaceService.getSpaces();
  }

  clickedSpace(URI: string) {
    console.log(URI);
  }

  exportResult(ev: any) {
    console.log('spaces');
    console.log(this.spaces);
    this.jsonExport = this._json_exportService.downloadFile(this.spaces);
    return this.jsonExport;
  }

  exportexcel(): void {
    /* pass here the table id */
    let element = document.getElementById('excel-table');
    const ws: XLSX.WorkSheet = XLSX.utils.table_to_sheet(element);

    /* generate workbook and add the worksheet */
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    /* save to file */
    XLSX.writeFile(wb, this.fileName);
    this.exportedToExcel = true;
  }

  importExcel(ev: any): void {
    let excelFile: File = ev.target.files[0];
    console.log('excelFile');
    console.log(excelFile);

    let fileReader = new FileReader();
    fileReader.readAsBinaryString(excelFile);

    fileReader.onload = (e) => {
      var workBook = XLSX.read(fileReader.result, { type: 'binary' });
      var sheetNames = workBook.SheetNames;
      this.excelData = XLSX.utils.sheet_to_json(workBook.Sheets[sheetNames[0]]);

      console.log(this.excelData);
      console.log('Uvalue', this.excelData[0].UValue);
      console.log('Walltypes', this.excelData[0].WallTypes);

      this.readyToCal = true;
    };
  }

  async implementUValues(ev: any) {
    // Binds the results from services/spaces to the variable spaces
    console.log('Inserting uvalues');
    await this._spaceService.insetUValues();
    console.log('Uvalues insertet');
    console.log(this.uValues);

    // Binds the results from services/spaces to the variable spaces
    console.log('getting inserted uvalues');
    this.createdUValues = await this._spaceService.getUValues();
    console.log('result from Uvalues insertet');
    console.log(this.createdUValues);
  }
}
