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
  public allTypes: any[] = [];
  public ifcElements: any[] = [];
  public allElements: any[] = [];
  public fileName = 'ExcelSheet.xlsx';
  public fileUploaded: boolean = false;
  public dataExtracted: boolean = false;
  public excelData: any;
  // public list: any;

  constructor(
    private _modelAdd: ModelAddService,
    private _elementService: ElementsService,
    private _comunica: ComunicaService
  ) {}

  ngOnInit(){
    this._comunica.getSources().subscribe(res => {
      console.log(res);
    })

    // this.list = [
    //   {
    //     title: 'IfcWall',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcWindow',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcSlab',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcDoor',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcRailing',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcStair',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcCurtainWall',
    //     checked: false,
    //   },
    //   {
    //     title: 'IfcRoof',
    //     checked: false,
    //   },
    // ]
    // return this.list
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

    // Get all types in the IFC file
    this.allTypes = await this._elementService.getTypes();

  }

  async extractData() {
    // When "Extract data"-button is clicked a SPARQL query will be run for each selected type
    this.allElements = [] ;
    for (var i of this.allTypes) {
      if (i.checked) {
        this.ifcElements = await this._elementService.getProps(i.type, i.typeWithURI);
        this.allElements.push(this.ifcElements)
    } 
  }
    // Parameter used in the html  
    this.dataExtracted = true ;
  }

  exportExcel(): void {
    // Export the query data to excel 
    let element = document.getElementById('excel-table');
    const ws: XLSX.WorkSheet = XLSX.utils.table_to_sheet(element);

    // Generate workbook and add the worksheet /
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    // Save to file /
    XLSX.writeFile(wb, this.fileName);
  }


  

}
