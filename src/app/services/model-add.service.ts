import { Injectable } from '@angular/core';
// import { ComunicaService, Source, SourceType } from 'ngx-comunica';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { Source, SourceType } from 'src/app/3rdparty/comunica/models';
import { IFCViewerService, LoadingStatus, ModelFileType, ModelLoaderService } from 'ngx-ifc-viewer';
import { LBDParsersService } from 'ngx-lbd-parsers';
import { lastValueFrom } from 'rxjs';
@Injectable({
providedIn: 'root'
})
export class ModelAddService {
  constructor(
    private _modelLoader: ModelLoaderService,
    private _viewer: IFCViewerService,
    private _lbd: LBDParsersService,
    private _comunica: ComunicaService
) { }

async loadModel(file: File): Promise<void>{
  return new Promise((resolve, reject) => {
    this._modelLoader.loadModel(file, ModelFileType.IFC).subscribe(async (status: LoadingStatus) => {
    // Load finished
    if(status.result != undefined){
      // Append model to scene
      this._viewer.appendModel(status.result);
      await this.parseRDF();
      resolve();
    }
  }, 
  err => {
    reject(err);
  });
})}


private async parseRDF(){
  const ifcManager = this._modelLoader.getIFCManager();

  const modelID = 0; // We only have one model!
  const store = await this._lbd.parseAll(ifcManager, modelID);
  
  // Add to data sources
  const source = new Source(store, SourceType.RDFJS);
  source.makePrimary();
  this._comunica.addSource(source);

  console.log("database size")
  console.log(store)
}
}

