// Authors: José Pablo Martínez Valdivia A01275676
// Date: 19/04/2023

const path = require('path');
const Csv = require('../models/csv.model');
const TicketDataset = require('../utils/CSVparser');
const db = require('../utils/database');
const Ticket = require('../models/ticket.model');
const { compareTickets } = require('../utils/compareTickets')

// Directory where the uploaded files will be saved
const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');

/** 
 * Handles the upload of a csv file.
 * The file is parsed, analysed and then used to generate epics and tickets on
 * the database.
 * The server responds with an object containing the message for the client.
 * @type {import("express").RequestHandler} 
 */
exports.file = async (req, res) => {
    // Check if a file named csv was sent 

    if (!(req.files && req.files.csv)) {
        // There was not a file named csv sent to the server
        res.status(400).json({e:'No file selected'});
        return;
    }
    // A file named csv was sent to the server

    // The csv file is extracted from the request
    const { csv } = req.files;

    // Checks if the file extension is ".csv"
    const extensionName = path.extname(csv.name);
    const allowedExtension = ['.csv'];

    if(!allowedExtension.includes(extensionName)){
        // The extension is not ".csv" 
        res.status(400).json({e: 'File must be CSV'});
        return;
    } 
    // The extension is ".csv" 

    // Check the size of the file buffer to avoid reading an empty buffer
    const buff = csv.data;
    if(!buff.length) {
        // The buffer was empty
        res.status(400).json({e: 'The file is empty'});
        return;
    }

    const dataset = TicketDataset.parseCSV(buff.toString());
    // We handle if the csv parser fails parsing the file
    if (dataset instanceof RangeError){
        res.status(400).json({e: 'Rows aren\'t the same lenght'});
        return;
    }
    else if(dataset instanceof TypeError){
        res.status(400).json({e: 'Row headers don\'t match'});
        return;
    }

    // We create a connection
    let connection;

    // The database throw errors when it fails
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        let insertedEpics = 0;
        let insertedTickets = 0;
        let updatedTickets = 0;
        // We save all the epics
        for(const elem of dataset.epics){
            const [epicRows] = await elem.save(connection);
            insertedEpics += epicRows.affectedRows;
        }
        // We save all the tickets
        for(const elem of dataset.tickets){
            const [existingTicket] = await Ticket.fetchByIssueKey(elem.issueKey);
            if(existingTicket.length === 0) {
                elem.save(connection);
                insertedTickets++;
            } else if (existingTicket.length === 1) {
                if(!compareTickets(existingTicket[0], elem)) {
                    elem.update(existingTicket[0].id_ticket, connection);
                    updatedTickets++;
                }
            } else {
                throw new Error('Database error');
            }
        }
        
        // We create a unique file name appending the time and the file name
        const fileSaveName = new Date().getTime() + '-' + csv.name;
        
        if(insertedEpics + insertedTickets + updatedTickets > 0){
            await new Csv({
                file_path: path.join('uploads', fileSaveName)
            }).save(connection);
            
            // Move file to uploads directory
            await csv.mv(path.join(uploadDirectory, fileSaveName));
        } else{
            await connection.rollback();
            return res.status(400).json({e : 'Duplicated file!'});
        }

        // If everything goes to plan, we commit the changes on the database and
        // send a success message.
        await connection.commit();
        res.json({e: 'Success'});

    } catch (e) {
        console.log(e);
        // If there is an error while inserting in the database, we rollback to 
        // the last state and send an error message to the client.
        await connection.rollback();
        res.status(500).json({e: 'Database connection failed'});
    }
}
