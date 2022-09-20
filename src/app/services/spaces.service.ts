import { Injectable } from '@angular/core';
// import { ComunicaService } from 'ngx-comunica';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { Source, SourceType } from 'src/app/3rdparty/comunica/models';
import { WKTObject, WKTObjectOptions } from 'ngx-ifc-viewer';
import { lastValueFrom } from 'rxjs';
import { Space } from '../models';
import { AppComponent } from '../app.component';

@Injectable({
  providedIn: 'root',
})
export class SpacesService {
  public queryResult?: any;
  public queryComplete: boolean = false;

  constructor(private _comunica: ComunicaService) {}

  async getSpaces(): Promise<Space[]> {
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

      return { URI, name };
    });
  }

  async insetUValues1(excelData: any) {

    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    PREFIX ex: <https://example.com/> 
    
    INSERT{ ?wall ex:uValue ?uValue } 
    WHERE {
    ?wall a ifc:IfcWallStandardCase ;
            <https://web-bim/resources/referencePsetWallcommon> ?type .
    
    VALUES ( ?type ?uValue ) 
    {("Basic Wall:Exterior - Brick on Block" 0.21 )
     ("Basic Wall:Foundation - Concrete (417mm)"  0.18 ) }
    } `;

    this.queryResult = undefined;
    this.queryComplete = false;

    try {
      this.queryResult = await this._comunica.updateQuery(query);
      this.queryComplete = true;
    } catch (err) {
      console.log(err);
    }
  }

  async insetUValues(excelData: any) {

    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
  PREFIX ex: <https://example.com/>
  
  INSERT DATA {<https://web-bim/resources/2O2Fr%24t4X7Zf8NOew3FNhv> ex:uValue ${excelData} } 
   `;

    this.queryResult = undefined;
    this.queryComplete = false;

    try {
      this.queryResult = await this._comunica.updateQuery(query);
      this.queryComplete = true;
    } catch (err) {
      console.log(err);
    }
  }

  async getUValues1(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    PREFIX ex: <https://example.com/> 
        
    SELECT ?wall ?uValue ?type
    WHERE{ ?wall ex:uValue ?uValue ; 
                 <https://web-bim/resources/referencePsetWallcommon> ?type } 
   `;
    const values = await lastValueFrom(this._comunica.selectQuery(query));
    return values.map((item: any) => {
      const wall = item.wall.value;
      const uValue = item.uValue.value;
      const type = item.type.value;

      return { wall, uValue, type };
    });
  }

  async getUValues(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> 
  PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#> 
  PREFIX kga: <https://w3id.org/kobl/geometry-analysis#> 
  PREFIX bot: <https://w3id.org/bot#>
  PREFIX ex: <https://example.com/> 
  
  SELECT ?space ?wallArea ?uValue ((?wallArea * ?uValue * 32 ) AS ?transmissionloss)
  WHERE{
  ?space a bot:Space .
   <https://web-bim/resources/2O2Fr%24t4X7Zf8NOew3FNhv> ex:uValue ?uValue
  
  {SELECT ?space (SUM(?a) AS ?wallArea) 
  WHERE{  
    ?i a bot:Interface ; 
  bot:interfaceOf ?space, <https://web-bim/resources/2O2Fr%24t4X7Zf8NOew3FNhv>  ;
   kga:area ?a .  
       } GROUP BY ?space }}
   `;
    const values = await lastValueFrom(this._comunica.selectQuery(query));
    return values.map((item: any) => {
      const space = item.space.value;
      const wallArea = item.wallArea.value;
      const uValue = item.uValue.value;
      const transmissionloss = item.transmissionloss.value;

      return { space, transmissionloss, wallArea, uValue };
    });
  }
}
