import { Injectable } from '@angular/core';
// import { ComunicaService } from 'ngx-comunica';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { Source, SourceType } from 'src/app/3rdparty/comunica/models';
import { WKTObject, WKTObjectOptions } from 'ngx-ifc-viewer';
import { lastValueFrom } from 'rxjs';
import { Space } from '../models';


@Injectable({
  providedIn: 'root'
})

export class SpacesService {
  public queryResult?: any;
  public queryComplete: boolean = false;

  constructor(
    private _comunica: ComunicaService
    ) { }
    
    async getSpaces(): Promise<Space[]>{
      const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
            
            SELECT DISTINCT ?type (GROUP_CONCAT(?wall) AS ?walls)
            WHERE {
            ?wall a ifc:IfcWallStandardCase ;
                    <https://web-bim/resources/isExternalPsetWallcommon> ?true ;
                    <https://web-bim/resources/referencePsetWallcommon> ?type ;
                  rdfs:label ?label .
            } GROUP BY ?type
      
       `;
      const spaces = await lastValueFrom(this._comunica.selectQuery(query));
      return spaces.map((item: any) => {
        const URI = item.type.value;
        const name = item.walls.value;

        return {URI, name};
      })
}



async insetUValues(){

  const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
  PREFIX ex: <https://web-bim/example/>
  
  INSERT DATA {<https://web-bim/resources/2O2Fr%24t4X7Zf8NOew3FNhv> ex:uValue 0.21 } 
   `;

  this.queryResult = undefined;
  this.queryComplete = false;

  try{
      this.queryResult = await this._comunica.updateQuery(query);
      this.queryComplete = true;
  }catch(err){
      console.log(err);
  }

}


async getUValues(): Promise<Space[]>{
  const query = `PREFIX ex: <https://example.com/> 
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
              
  SELECT ?p ?o
  WHERE {
    <https://web-bim/resources/2O2Fr%24t4X7Zf8NOew3FNhv> ?p ?o  } LIMIT 100
   `;
  const values = await lastValueFrom(this._comunica.selectQuery(query));
    return values.map((item: any) => {
      const wall = item.p.value;
      const type = item.o.value;

      return {wall, type};
  })
}


}
